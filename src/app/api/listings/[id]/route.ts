import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { verifyAdmin } from "@/lib/auth";
import { PricingUnit } from "@prisma/client";
import { UpdateListingSchema } from "@/lib/schemas";
import {
  ACTIVE_ORDER_STATUSES,
  decideListingDeletion,
  decideSellerRelist,
  sellerRelistWhereGuard,
} from "@/lib/listing-policy";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Get a single listing
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const listing = await db.eggListing.findUnique({
      where: { id },
      include: {
        tags: true,
        seller: {
          include: {
            user: {
              select: {
                username: true,
              },
            },
          },
        },
      },
    });

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Visibility gate: subscription-hidden and seller/admin-disabled listings
    // are not public. The owner and admins keep read access so dashboards and
    // reconciliation keep working. Fully public listings need no auth work.
    const isPublic = listing.isAvailable && !listing.hiddenBySubscription;
    if (!isPublic) {
      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json({ error: "Listing not found" }, { status: 404 });
      }

      const user = await db.user.findUnique({
        where: { clerkId: userId },
        select: { sellerProfile: { select: { id: true } } },
      });
      const isOwner = user?.sellerProfile?.id === listing.sellerId;
      const isAdmin = await verifyAdmin();
      if (!isOwner && !isAdmin) {
        return NextResponse.json({ error: "Listing not found" }, { status: 404 });
      }
    }

    return NextResponse.json(listing);
  } catch (error) {
    console.error("Error fetching listing:", error);
    return NextResponse.json({ error: "Failed to fetch listing" }, { status: 500 });
  }
}

// Update a listing
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId, has } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Clerk's has() is the authoritative subscription check
    const hasListingFeature = has?.({ feature: "listing" }) ?? false;
    if (!hasListingFeature) {
      return NextResponse.json(
        { error: "Seller subscription required to edit listings", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      );
    }

    const { id } = await params;

    // Get user and verify ownership
    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { sellerProfile: true },
    });

    if (!user || !user.sellerProfile) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    // Check listing exists and belongs to user
    const existingListing = await db.eggListing.findUnique({
      where: { id },
      include: { tags: true },
    });

    if (!existingListing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (existingListing.sellerId !== user.sellerProfile.id) {
      return NextResponse.json({ error: "Not authorized to edit this listing" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = UpdateListingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 });
    }
    const {
      title,
      description,
      pricePerUnit,
      unit,
      customUnitName,
      customUnitQty,
      stockCount,
      photos,
      tags,
      isAvailable,
    } = parsed.data;

    // Lifecycle rule (pure core): a subscription-hidden listing may not be
    // flipped back to public visibility; the activation webhook owns that flag.
    const relist = decideSellerRelist(
      {
        isAvailable: existingListing.isAvailable,
        hiddenBySubscription: existingListing.hiddenBySubscription,
      },
      isAvailable
    );
    if (!relist.allowed) {
      return NextResponse.json(
        { error: relist.message, code: relist.code },
        { status: 403 }
      );
    }

    // Handle tags - connect existing or create new ones
    const tagConnections = await Promise.all(
      (tags || []).map(async (tagName: string) => {
        const slug = tagName.toLowerCase().replace(/\s+/g, "-");
        const tag = await db.tag.upsert({
          where: { slug },
          update: {},
          create: { name: tagName, slug },
        });
        return { id: tag.id };
      })
    );

    // Update listing atomically with ownership check (updateMany supports non-unique where)
    const sellerId = user.sellerProfile!.id;
    const [updated] = await db.$transaction(async (tx) => {
      // A relist write carries the policy where-guard so a listing hidden by a
      // concurrent webhook expiry cannot be re-listed between the pre-check
      // and this write (result.count 0 → HIDDEN_BY_SUBSCRIPTION below).
      const result = await tx.eggListing.updateMany({
        where: {
          id,
          sellerId,
          ...(isAvailable === true ? sellerRelistWhereGuard() : {}),
        },
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          pricePerUnit,
          unit: unit as PricingUnit,
          customUnitName: unit === "CUSTOM" ? customUnitName ?? null : null,
          customUnitQty: unit === "CUSTOM" ? customUnitQty ?? null : null,
          stockCount: stockCount || 0,
          photos: photos || [],
          isAvailable: isAvailable !== undefined ? isAvailable : existingListing.isAvailable,
        },
      });

      if (result.count === 0) {
        // Distinguish not-found vs not-authorized vs re-list-race-lost
        const exists = await tx.eggListing.findUnique({
          where: { id },
          select: { id: true, hiddenBySubscription: true },
        });
        if (exists && isAvailable === true && exists.hiddenBySubscription) {
          // Webhook hid the listing between our pre-check and the write
          throw new Error("HIDDEN_BY_SUBSCRIPTION");
        }
        throw new Error(exists ? "NOT_AUTHORIZED" : "NOT_FOUND");
      }

      // Update tags separately (updateMany doesn't support relations)
      await tx.eggListing.update({
        where: { id },
        data: {
          tags: {
            set: [],
            connect: tagConnections,
          },
        },
      });

      return [await tx.eggListing.findUnique({ where: { id }, include: { tags: true } })];
    });

    if (!updated) {
      return NextResponse.json({ error: "Listing not found after update" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "HIDDEN_BY_SUBSCRIPTION") {
      return NextResponse.json(
        {
          error: "Listing is hidden by subscription expiry. Reactivate your subscription to relist it.",
          code: "LISTING_HIDDEN_BY_SUBSCRIPTION",
        },
        { status: 403 }
      );
    }
    if (error instanceof Error && error.message === "NOT_AUTHORIZED") {
      return NextResponse.json({ error: "Not authorized to edit this listing" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    console.error("Error updating listing:", error);
    return NextResponse.json({ error: "Failed to update listing" }, { status: 500 });
  }
}

// Delete a listing
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Get user and verify ownership
    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { sellerProfile: true },
    });

    if (!user || !user.sellerProfile) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    // Check listing exists and belongs to user
    const existingListing = await db.eggListing.findUnique({
      where: { id },
    });

    if (!existingListing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (existingListing.sellerId !== user.sellerProfile.id) {
      return NextResponse.json({ error: "Not authorized to delete this listing" }, { status: 403 });
    }

    // Delete under the policy core, inside a transaction that locks the listing
    // row: an order created concurrently blocks (FK) and the deletion
    // re-checks active orders against the locked state instead of a racy read.
    const sellerId = user.sellerProfile.id;
    const outcome = await db.$transaction(async (tx) => {
      // Serialize order-creation vs. deletion on this listing row. The FK from
      // Order.listing is Restrict, so this lock makes concurrent orders wait
      // and fail cleanly instead of racing a free deleteMany.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "EggListing" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        return { kind: "NOT_FOUND" as const };
      }

      // Active (PENDING/CONFIRMED/PAID) orders block deletion: money and
      // fulfillment must stay traceable. Pure decision, shared with admin.
      const activeOrderCount = await tx.order.count({
        where: { listingId: id, status: { in: [...ACTIVE_ORDER_STATUSES] } },
      });

      if (!decideListingDeletion(activeOrderCount).allowed) {
        return { kind: "ACTIVE_ORDERS" as const };
      }

      // Atomic ownership-checked delete
      const result = await tx.eggListing.deleteMany({
        where: { id, sellerId },
      });

      return result.count === 0
        ? ({ kind: "NOT_FOUND" as const }) // deleted between check and delete (race) — treat as not found
        : ({ kind: "DELETED" as const });
    });

    if (outcome.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    if (outcome.kind === "ACTIVE_ORDERS") {
      return NextResponse.json(
        { error: "Cannot delete listing with active orders", code: "LISTING_HAS_ACTIVE_ORDERS" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting listing:", error);
    return NextResponse.json({ error: "Failed to delete listing" }, { status: 500 });
  }
}