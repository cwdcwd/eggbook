import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { verifyAdmin } from "@/lib/auth";
import { AdminUserActionSchema } from "@/lib/schemas";
import {
  sellerSuspensionHideSpec,
  sellerSuspensionRestoreSpec,
} from "@/lib/listing-policy";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Update user (suspend/unsuspend, change role)
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
    const parsed = AdminUserActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 });
    }
    const { action, role } = parsed.data;

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
      case "suspend": {
        // Server-side entitlement enforcement: suspending a seller also takes
        // their publicly visible listings off the market with the suspension
        // marker (hiddenBySuspension), so buyers can no longer fetch, order,
        // or favorite them through public paths. Rows the subscription
        // webhook hid and rows the seller deliberately paused are untouched,
        // so unsuspend restores exactly what the suspension hid.
        if (targetUser.sellerProfile) {
          // Acquires the SAME per-seller advisory lock the listing-create
          // transaction holds (keyed on the user row) BEFORE flipping, so a
          // concurrent create that already passed its in-transaction
          // eligibility re-check cannot insert a still-public listing after
          // this suspension lands.
          await db.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seller-entitlement:${targetUser.id}`}), 0)`;
            await tx.sellerProfile.update({
              where: { id: targetUser.sellerProfile!.id },
              data: { isActive: false },
            });
            await tx.eggListing.updateMany(
              sellerSuspensionHideSpec(targetUser.sellerProfile!.id)
            );
          });
        }
        return NextResponse.json({ success: true, message: "User suspended" });
      }

      case "unsuspend": {
        // Reactivate the profile and re-list exactly the rows the suspension
        // hid (sellerSuspensionRestoreSpec matches the marker only): a
        // subscription-hidden listing stays hidden (the activation webhook
        // owns that flag) and a seller-paused listing stays paused.
        if (targetUser.sellerProfile) {
          // Same per-seller advisory lock as suspend/create: keeps the
          // entitlement flip serialized against concurrent listing creates
          // and other entitlement flips for this seller.
          await db.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seller-entitlement:${targetUser.id}`}), 0)`;
            await tx.sellerProfile.update({
              where: { id: targetUser.sellerProfile!.id },
              data: { isActive: true },
            });
            await tx.eggListing.updateMany(
              sellerSuspensionRestoreSpec(targetUser.sellerProfile!.id)
            );
          });
        }
        return NextResponse.json({ success: true, message: "User unsuspended" });
      }

      case "change_role": {
        if (!role) {
          return NextResponse.json({ error: "Role is required" }, { status: 400 });
        }
        // Role changes away from SELLER carry the same entitlement policy as
        // suspension (hide with the marker); restoring the SELLER role is a
        // restore event (reactivate the profile, re-list exactly the marked
        // rows). No seller profile → only the role itself changes. The
        // per-seller advisory lock (same key as the listing-create
        // transaction) serializes this entitlement flip against concurrent
        // creates, so a create that started before the role change cannot
        // insert a still-public listing after it lands.
        const leavingSeller = role !== "SELLER" && !!targetUser.sellerProfile;
        const becomingSeller = role === "SELLER" && !!targetUser.sellerProfile;
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seller-entitlement:${targetUser.id}`}), 0)`;
          await tx.user.update({
            where: { id },
            data: { role },
          });
          if (leavingSeller) {
            await tx.sellerProfile.update({
              where: { id: targetUser.sellerProfile!.id },
              data: { isActive: false },
            });
            await tx.eggListing.updateMany(
              sellerSuspensionHideSpec(targetUser.sellerProfile!.id)
            );
          } else if (becomingSeller) {
            await tx.sellerProfile.update({
              where: { id: targetUser.sellerProfile!.id },
              data: { isActive: true },
            });
            await tx.eggListing.updateMany(
              sellerSuspensionRestoreSpec(targetUser.sellerProfile!.id)
            );
          }
        });
        return NextResponse.json({ success: true, message: `Role changed to ${role}` });
      }

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

    const isAdmin = await verifyAdmin();
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

    // Deactivation is terminal (no restore action) — listings are taken off
    // the market without the suspension marker so no future unsuspend can
    // silently re-list a deactivated user's inventory.
    if (targetUser.sellerProfile) {
      // Same per-seller advisory lock as suspend/unsuspend/role-change and
      // the listing-create transaction (keyed on the user row): a
      // deactivation whose isActive flip is still uncommitted cannot be
      // observed by a concurrent create's eligibility re-read, and a create
      // that completed before the lock cannot land a still-public row after
      // the unfiltered hide — the hide takes every row of the seller,
      // including anything it just created.
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seller-entitlement:${targetUser.id}`}), 0)`;
        await tx.sellerProfile.update({
          where: { id: targetUser.sellerProfile!.id },
          data: { isActive: false },
        });

        await tx.eggListing.updateMany({
          where: { sellerId: targetUser.sellerProfile!.id },
          data: { isAvailable: false },
        });
      });
    }

    return NextResponse.json({ success: true, message: "User deactivated" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}