import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { PricingUnit } from "@prisma/client";
import { getOrCreateUser } from "@/lib/auth";

// Create a new listing
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user with seller profile
    const user = await getOrCreateUser(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Auto-create seller profile if doesn't exist (upgrade to SELLER role)
    let sellerProfile = user.sellerProfile;
    if (!sellerProfile) {
      sellerProfile = await db.sellerProfile.create({
        data: {
          userId: user.id,
          displayName: user.username,
        },
      });

      // Upgrade user role to SELLER
      await db.user.update({
        where: { id: user.id },
        data: { role: "SELLER" },
      });
    }

    const body = await req.json();
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
    } = body;

    // Validate required fields
    if (!title || title.trim() === "") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!pricePerUnit || pricePerUnit <= 0) {
      return NextResponse.json({ error: "Valid price is required" }, { status: 400 });
    }

    // Validate unit
    const validUnits: PricingUnit[] = ["EGG", "HALF_DOZEN", "DOZEN", "FLAT", "CUSTOM"];
    if (!validUnits.includes(unit as PricingUnit)) {
      return NextResponse.json({ error: "Invalid pricing unit" }, { status: 400 });
    }

    // If CUSTOM unit, require custom fields
    if (unit === "CUSTOM") {
      if (!customUnitName || !customUnitQty) {
        return NextResponse.json(
          { error: "Custom unit name and quantity required for custom pricing" },
          { status: 400 }
        );
      }
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

    // Create listing
    const listing = await db.eggListing.create({
      data: {
        sellerId: sellerProfile.id,
        title: title.trim(),
        description: description?.trim() || null,
        pricePerUnit: parseFloat(pricePerUnit),
        unit: unit as PricingUnit,
        customUnitName: unit === "CUSTOM" ? customUnitName : null,
        customUnitQty: unit === "CUSTOM" ? parseInt(customUnitQty) : null,
        stockCount: parseInt(stockCount) || 0,
        photos: photos || [],
        tags: {
          connect: tagConnections,
        },
      },
      include: {
        tags: true,
      },
    });

    return NextResponse.json(listing, { status: 201 });
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
