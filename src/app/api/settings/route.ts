import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

// Get current user's seller profile
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      sellerProfile: user.sellerProfile,
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// Update seller profile settings
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      displayName,
      bio,
      address,
      city,
      state,
      zip,
      maxDeliveryDistance,
      pickupType,
    } = body;

    // Validate required fields
    if (!displayName || displayName.trim() === "") {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    // Parse maxDeliveryDistance
    const maxDeliveryDistanceFloat = maxDeliveryDistance
      ? parseFloat(maxDeliveryDistance)
      : null;

    // Upsert seller profile (create if doesn't exist)
    const sellerProfile = await db.sellerProfile.upsert({
      where: { userId: user.id },
      update: {
        displayName: displayName.trim(),
        bio: bio?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        zip: zip?.trim() || null,
        maxDeliveryDistance: maxDeliveryDistanceFloat,
        pickupType: pickupType || "ARRANGED",
      },
      create: {
        userId: user.id,
        displayName: displayName.trim(),
        bio: bio?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        zip: zip?.trim() || null,
        maxDeliveryDistance: maxDeliveryDistanceFloat,
        pickupType: pickupType || "ARRANGED",
      },
    });

    // Update user role to SELLER if not already
    if (user.role !== "SELLER" && user.role !== "ADMIN") {
      await db.user.update({
        where: { id: user.id },
        data: { role: "SELLER" },
      });
    }

    return NextResponse.json(sellerProfile);
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
