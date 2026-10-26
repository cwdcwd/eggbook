import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { PricingUnit } from "@prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { canCreateListing } from "@/lib/subscription";
import { CreateListingSchema } from "@/lib/schemas";
import { decideListingCapCreate } from "@/lib/listing-policy";

// Create a new listing
export async function POST(req: NextRequest) {
  try {
    const { userId, has } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Clerk's has() is the authoritative subscription check
    const hasListingFeature = has?.({ feature: "listing" }) ?? false;
    if (!hasListingFeature) {
      return NextResponse.json(
        { error: "Seller subscription required to create listings", code: "SUBSCRIPTION_REQUIRED" },
        { status: 403 }
      );
    }

    // Ensure user exists in DB before checking limits
    const user = await getOrCreateUser(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // DB check for listing limits only (not subscription status). Fast-fail
    // only — the authoritative check re-runs inside the create transaction
    // below, where concurrent creates by the same seller cannot interleave.
    const dbCheck = await canCreateListing(userId);
    if (!dbCheck.allowed) {
      return NextResponse.json(
        { error: dbCheck.reason, code: dbCheck.code },
        { status: 403 }
      );
    }

    // Auto-create seller profile if doesn't exist (upgrade to SELLER role)
    let sellerProfile = user.sellerProfile;
    if (!sellerProfile) {
      // Get Clerk user for avatar
      const clerkUser = await currentUser();
      
      sellerProfile = await db.sellerProfile.create({
        data: {
          userId: user.id,
          displayName: user.username,
          avatarUrl: clerkUser?.imageUrl || null,
        },
      });

      // Upgrade user role to SELLER
      await db.user.update({
        where: { id: user.id },
        data: { role: "SELLER" },
      });
    }

    const body = await req.json();
    const parsed = CreateListingSchema.safeParse(body);
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
    } = parsed.data;

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

    // Create inside a per-seller-serialized transaction. The advisory lock
    // makes {re-read the limit, count the listings, insert} a critical
    // section: a concurrent create by the same seller cannot interleave its
    // own count between this transaction's count and insert, which a plain
    // count-then-create would allow (both pass, both insert, cap exceeded).
    // The pure decision runs against the in-transaction count.
    const outcome = await db.$transaction(async (tx) => {
      // Two-int form keeps the lock namespaced away from any other hashtext
      // advisory use; keying on the seller profile serializes only this
      // seller's creates. Released automatically at transaction end.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`listing-cap:${sellerProfile.id}`}), 0)`;

      const fresh = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          listingLimit: true,
          sellerProfile: {
            select: { _count: { select: { listings: true } } },
          },
        },
      });
      if (!fresh) {
        return { kind: "USER_NOT_FOUND" as const };
      }

      const cap = decideListingCapCreate(
        fresh.sellerProfile?._count.listings ?? 0,
        fresh.listingLimit
      );
      if (!cap.allowed) {
        return { kind: "LISTING_LIMIT_REACHED" as const, reason: cap.message };
      }

      const listing = await tx.eggListing.create({
        data: {
          sellerId: sellerProfile.id,
          title: title.trim(),
          description: description?.trim() || null,
          pricePerUnit,
          unit: unit as PricingUnit,
          customUnitName: unit === "CUSTOM" ? customUnitName ?? null : null,
          customUnitQty: unit === "CUSTOM" ? customUnitQty ?? null : null,
          stockCount: stockCount || 0,
          photos: photos || [],
          tags: {
            connect: tagConnections,
          },
        },
        include: {
          tags: true,
        },
      });
      return { kind: "CREATED" as const, listing };
    });

    if (outcome.kind === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (outcome.kind === "LISTING_LIMIT_REACHED") {
      return NextResponse.json(
        { error: outcome.reason, code: "LISTING_LIMIT_REACHED" },
        { status: 403 }
      );
    }

    return NextResponse.json(outcome.listing, { status: 201 });
  } catch (error) {
    console.error("Error creating listing:", error);
    return NextResponse.json({ error: "Failed to create listing" }, { status: 500 });
  }
}

// Get listings for current user (seller dashboard)
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);

    if (!user) {
      return NextResponse.json([]);
    }

    if (!user.sellerProfile) {
      // No seller profile yet, return empty array
      return NextResponse.json([]);
    }

    const listings = await db.eggListing.findMany({
      where: { sellerId: user.sellerProfile.id },
      include: {
        tags: true,
        _count: {
          select: { orders: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(listings);
  } catch (error) {
    console.error("Error fetching listings:", error);
    return NextResponse.json({ error: "Failed to fetch listings" }, { status: 500 });
  }
}