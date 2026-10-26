import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { verifyAdmin } from "@/lib/auth";
import { ACTIVE_ORDER_STATUSES, decideListingDeletion } from "@/lib/listing-policy";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Update listing (toggle availability, flag for review)
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { action } = body;

    const listing = await db.eggListing.findUnique({
      where: { id },
      include: { seller: { select: { isActive: true } } },
    });

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    switch (action) {
      case "disable":
        await db.eggListing.update({
          where: { id },
          data: { isAvailable: false },
        });
        return NextResponse.json({ success: true, message: "Listing disabled" });

      case "enable":
        // Admin enable restores public visibility for the subscription-hidden
        // reason: clearing hiddenBySubscription keeps the expiry webhook's
        // flag from fighting the admin's decision (expiry re-sets it on next
        // fire). BUT a suspended/inactive seller's listings stay hidden: the
        // unsuspend action owns restoring suspension-marker rows, the same
        // way the activation webhook owns restoring hiddenBySubscription
        // rows — so enable refuses instead of either violating the seller
        // suspension outright or silently re-listing one row of a hidden
        // seller.
        if (listing.seller && !listing.seller.isActive) {
          return NextResponse.json(
            {
              error: "Seller account is suspended; unsuspend the seller before enabling listings",
              code: "SELLER_SUSPENDED",
            },
            { status: 409 }
          );
        }
        await db.eggListing.update({
          where: { id },
          data: { isAvailable: true, hiddenBySubscription: false },
        });
        return NextResponse.json({ success: true, message: "Listing enabled" });

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error updating listing:", error);
    return NextResponse.json({ error: "Failed to update listing" }, { status: 500 });
  }
}

// Delete listing
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    const listing = await db.eggListing.findUnique({
      where: { id },
    });

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Same locked-transaction retention policy as the seller DELETE: the row
    // lock serializes concurrent order creation, and the retention decision
    // runs against counts read inside the lock. ACTIVE orders → 400; any
    // historical order → 409; no coded path can ever hit the RESTRICT FK.
    const outcome = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "EggListing" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        return { kind: "NOT_FOUND" as const };
      }

      const [totalOrderCount, activeOrderCount] = await Promise.all([
        tx.order.count({ where: { listingId: id } }),
        tx.order.count({
          where: { listingId: id, status: { in: [...ACTIVE_ORDER_STATUSES] } },
        }),
      ]);

      const deletion = decideListingDeletion(totalOrderCount, activeOrderCount);
      if (!deletion.allowed) {
        return { kind: "BLOCKED" as const, code: deletion.code, message: deletion.message };
      }

      await tx.eggListing.delete({ where: { id } });
      return { kind: "DELETED" as const };
    });

    if (outcome.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    if (outcome.kind === "BLOCKED") {
      return NextResponse.json(
        { error: outcome.message, code: outcome.code },
        { status: outcome.code === "LISTING_HAS_ACTIVE_ORDERS" ? 400 : 409 }
      );
    }

    return NextResponse.json({ success: true, message: "Listing deleted" });
  } catch (error) {
    console.error("Error deleting listing:", error);
    return NextResponse.json({ error: "Failed to delete listing" }, { status: 500 });
  }
}