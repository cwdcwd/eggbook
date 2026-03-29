import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { PricingUnit } from "@prisma/client";

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

    return NextResponse.json(listing);
  } catch (error) {
    console.error("Error fetching listing:", error);
    return NextResponse.json({ error: "Failed to fetch listing" }, { status: 500 });
  }
}

// Update a listing
export async function PUT(req: NextRequest, { params }: RouteParams) {
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
      include: { tags: true },
    });

    if (!existingListing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (existingListing.sellerId !== user.sellerProfile.id) {
      return NextResponse.json({ error: "Not authorized to edit this listing" }, { status: 403 });
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
      isAvailable,
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

    // Update listing
    const listing = await db.eggListing.update({
      where: { id },
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        pricePerUnit: parseFloat(pricePerUnit),
        unit: unit as PricingUnit,
        customUnitName: unit === "CUSTOM" ? customUnitName : null,
        customUnitQty: unit === "CUSTOM" ? parseInt(customUnitQty) : null,
        stockCount: parseInt(stockCount) || 0,
        photos: photos || [],
        isAvailable: isAvailable !== undefined ? isAvailable : existingListing.isAvailable,
        tags: {
          set: [], // Disconnect all existing tags
          connect: tagConnections, // Connect new tags
        },
      },
      include: {
        tags: true,
      },
    });

    return NextResponse.json(listing);
  } catch (error) {
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

    // Check for active orders
    const activeOrders = await db.order.count({
      where: {
        listingId: id,
        status: { in: ["PENDING", "CONFIRMED", "PAID"] },
      },
    });

    if (activeOrders > 0) {
      return NextResponse.json(
        { error: "Cannot delete listing with active orders" },
        { status: 400 }
      );
    }

    // Delete listing
    await db.eggListing.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting listing:", error);
    return NextResponse.json({ error: "Failed to delete listing" }, { status: 500 });
  }
}
