import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Admin middleware helper
async function verifyAdmin(userId: string) {
  const user = await db.user.findUnique({
    where: { clerkId: userId },
  });
  return user?.role === "ADMIN";
}

// Update listing (toggle availability, flag for review)
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await verifyAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { action } = body;

    const listing = await db.eggListing.findUnique({
      where: { id },
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
        await db.eggListing.update({
          where: { id },
          data: { isAvailable: true },
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

    const isAdmin = await verifyAdmin(userId);
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

    // Check for active orders
    const activeOrders = await db.order.count({
      where: {
        listingId: id,
        status: { in: ["PENDING", "CONFIRMED", "PAID"] },
      },
    });

    if (activeOrders > 0) {
      return NextResponse.json(
        { error: "Cannot delete listing with active orders. Disable it instead." },
        { status: 400 }
      );
    }

    // Delete listing
    await db.eggListing.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "Listing deleted" });
  } catch (error) {
    console.error("Error deleting listing:", error);
    return NextResponse.json({ error: "Failed to delete listing" }, { status: 500 });
  }
}
