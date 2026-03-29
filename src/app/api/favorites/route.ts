import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";

// Add a seller to favorites
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const { sellerProfileId } = body;

    if (!sellerProfileId) {
      return NextResponse.json({ error: "Seller profile ID required" }, { status: 400 });
    }

    // Check if seller profile exists
    const sellerProfile = await db.sellerProfile.findUnique({
      where: { id: sellerProfileId },
    });

    if (!sellerProfile) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    // Create favorite (ignore if already exists)
    const favorite = await db.favorite.upsert({
      where: {
        userId_sellerProfileId: {
          userId: user.id,
          sellerProfileId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        sellerProfileId,
      },
    });

    return NextResponse.json(favorite, { status: 201 });
  } catch (error) {
    console.error("Error adding favorite:", error);
    return NextResponse.json({ error: "Failed to add favorite" }, { status: 500 });
  }
}

// Get user's favorites
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

    const favorites = await db.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    // Fetch seller profiles separately since there's no relation in schema
    const sellerProfileIds = favorites.map((f) => f.sellerProfileId);
    const sellerProfiles = await db.sellerProfile.findMany({
      where: { id: { in: sellerProfileIds } },
      include: {
        user: {
          select: {
            username: true,
          },
        },
        listings: {
          where: { isAvailable: true },
          take: 3,
        },
      },
    });

    // Map favorites to include seller profile data
    const favoritesWithProfiles = favorites.map((fav) => ({
      ...fav,
      sellerProfile: sellerProfiles.find((sp) => sp.id === fav.sellerProfileId),
    }));

    return NextResponse.json(favoritesWithProfiles);
  } catch (error) {
    console.error("Error fetching favorites:", error);
    return NextResponse.json({ error: "Failed to fetch favorites" }, { status: 500 });
  }
}

// Remove a favorite
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const sellerProfileId = searchParams.get("sellerProfileId");

    if (!sellerProfileId) {
      return NextResponse.json({ error: "Seller profile ID required" }, { status: 400 });
    }

    await db.favorite.deleteMany({
      where: {
        userId: user.id,
        sellerProfileId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing favorite:", error);
    return NextResponse.json({ error: "Failed to remove favorite" }, { status: 500 });
  }
}
