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

// Update user (suspend/unsuspend, change role)
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
    const { action, role } = body;

    const targetUser = await db.user.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent self-modification
    const adminUser = await db.user.findUnique({
      where: { clerkId: userId },
    });
    if (adminUser?.id === id) {
      return NextResponse.json({ error: "Cannot modify your own account" }, { status: 400 });
    }

    switch (action) {
      case "suspend":
        // Deactivate seller profile if exists
        if (targetUser.sellerProfile) {
          await db.sellerProfile.update({
            where: { id: targetUser.sellerProfile.id },
            data: { isActive: false },
          });
        }
        return NextResponse.json({ success: true, message: "User suspended" });

      case "unsuspend":
        // Reactivate seller profile if exists
        if (targetUser.sellerProfile) {
          await db.sellerProfile.update({
            where: { id: targetUser.sellerProfile.id },
            data: { isActive: true },
          });
        }
        return NextResponse.json({ success: true, message: "User unsuspended" });

      case "change_role":
        if (!role || !["BUYER", "SELLER", "ADMIN"].includes(role)) {
          return NextResponse.json({ error: "Invalid role" }, { status: 400 });
        }
        await db.user.update({
          where: { id },
          data: { role },
        });
        return NextResponse.json({ success: true, message: `Role changed to ${role}` });

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// Delete user (soft delete by deactivating)
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

    const targetUser = await db.user.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent self-deletion
    const adminUser = await db.user.findUnique({
      where: { clerkId: userId },
    });
    if (adminUser?.id === id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    // Deactivate seller profile if exists
    if (targetUser.sellerProfile) {
      await db.sellerProfile.update({
        where: { id: targetUser.sellerProfile.id },
        data: { isActive: false },
      });

      // Deactivate all listings
      await db.eggListing.updateMany({
        where: { sellerId: targetUser.sellerProfile.id },
        data: { isAvailable: false },
      });
    }

    return NextResponse.json({ success: true, message: "User deactivated" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
