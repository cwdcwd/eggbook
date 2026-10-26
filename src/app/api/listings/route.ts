import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { PricingUnit } from "@prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { canCreateListing } from "@/lib/subscription";
import { CreateListingSchema } from "@/lib/schemas";
import { decideListingCapCreate, decideSellerCreateEligibility } from "@/lib/listing-policy";

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

    // Seller-entitlement fast-fail (the authoritative re-check runs inside
    // the create transaction below on freshly read state, race-tight against
    // a concurrent suspend / role change via the shared advisory lock): a
    // suspended or de-entitled seller cannot create listings, and this route
    // never re-uplifts a role an admin changed away from SELLER.
    const preEligibility = decideSellerCreateEligibility({
      role: user.role,
      hasSellerProfile: !!user.sellerProfile,
      sellerProfileIsActive: user.sellerProfile?.isActive ?? null,
    });
    if (!preEligibility.allowed) {
      return NextResponse.json(
        { error: preEligibility.message, code: preEligibility.code },
        { status: preEligibility.code === "SELLER_SUSPENDED" ? 409 : 403 }
      );
    }

    // Fast-fail cap check. Authoritative checks re-run inside the create
    // transaction below, where concurrent writes by the same seller cannot
    // interleave.
    const dbCheck = await canCreateListing(userId);
    if (!dbCheck.allowed) {
      return NextResponse.json(
        { error: dbCheck.reason, code: dbCheck.code },
        { status: 403 }
      );
    }

    // First-time bootstrap inputs are hoisted outside the transaction (only
    // fetched when the user has no profile yet). The profile itself is
    // created INSIDE the transaction below — and only for a user whose role
    // is already SELLER, so this route can never resurrect an entitlement an
    // admin removed.
    const bootstrapAvatarUrl = user.sellerProfile
      ? null
      : (await currentUser())?.imageUrl ?? null;

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
    // makes {re-read the user's role + profile, re-read the limit, count the
    // listings, insert} a critical section: a concurrent create by the same
    // seller cannot interleave its own count between this transaction's
    // count and insert, which a plain count-then-create would allow (both
    // pass, both insert, cap exceeded) — and a concurrent suspend / role
    // change cannot interleave its entitlement flip between this
    // transaction's eligibility read and insert either, because those admin
    // transactions acquire the SAME per-seller advisory lock before
    // flipping. The pure decisions run against the in-transaction reads.
    const outcome = await db.$transaction(async (tx) => {
      // Two-int form keeps the lock namespaced away from any other hashtext
      // advisory use; keying on the user row serializes this seller's
      // creates AND the admin entitlement flips over the same seller. The
      // same key is acquired first by every admin users PUT/DELETE
      // transaction. Released automatically at transaction end.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seller-entitlement:${user.id}`}), 0)`;

      const fresh = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          role: true,
          listingLimit: true,
          sellerProfile: {
            select: {
              id: true,
              isActive: true,
              _count: { select: { listings: true } },
            },
          },
        },
      });
      if (!fresh) {
        return { kind: "USER_NOT_FOUND" as const };
      }

      // Entitlement re-check inside the locked transaction: a suspension or
      // role change that committed before we took the lock is visible here,
      // so the listing is never created for an inactive or de-entitled
      // seller (the pre-tx fast-fail above cannot be race-tight by itself).
      const eligibility = decideSellerCreateEligibility({
        role: fresh.role,
        hasSellerProfile: !!fresh.sellerProfile,
        sellerProfileIsActive: fresh.sellerProfile?.isActive ?? null,
      });
      if (!eligibility.allowed) {
        return eligibility.code === "SELLER_SUSPENDED"
          ? ({ kind: "SELLER_SUSPENDED" as const, reason: eligibility.message })
          : ({ kind: "NOT_A_SELLER" as const, reason: eligibility.message });
      }

      // Bootstrap a missing profile for an active SELLER — no role write
      // here: role SELLER is a precondition we just checked, not something
      // this route grants.
      let sellerProfileId = fresh.sellerProfile?.id;
      if (!sellerProfileId) {
        const bootstrapProfile = await tx.sellerProfile.create({
          data: {
            userId: user.id,
            displayName: user.username,
            avatarUrl: bootstrapAvatarUrl,
          },
        });
        sellerProfileId = bootstrapProfile.id;
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
          sellerId: sellerProfileId,
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
    if (outcome.kind === "SELLER_SUSPENDED" || outcome.kind === "NOT_A_SELLER") {
      return NextResponse.json(
        { error: outcome.reason, code: outcome.kind },
        { status: outcome.kind === "SELLER_SUSPENDED" ? 409 : 403 }
      );
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