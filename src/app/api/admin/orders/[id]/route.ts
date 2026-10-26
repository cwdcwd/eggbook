import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { verifyAdmin } from "@/lib/auth";
import { AdminOrderStatusSchema } from "@/lib/schemas";
import { logOrderStatusChange } from "@/lib/order-audit";
import { expireCheckoutSession } from "@/lib/stripe";
import { nextAdminStatus, type AdminStatusRejectionCode } from "@/lib/payment-integrity";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Get single order details
export async function GET(req: NextRequest, { params }: RouteParams) {
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

    const order = await db.order.findUnique({
      where: { id },
      include: {
        listing: true,
        buyer: true,
        seller: {
          include: { user: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}

// Update order status (admin override)
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
    const parsed = AdminOrderStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 });
    }
    const { status, cancelReason } = parsed.data;

    const order = await db.order.findUnique({
      where: { id },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const rejectionMessages: Record<AdminStatusRejectionCode, string> = {
      terminal: "Order is in a terminal status and cannot be overridden",
      "payment-transition-forbidden": "Paid orders cannot be cancelled — refund via the admin refund endpoint",
    };

    const rule = nextAdminStatus(order.status, status, Boolean(order.stripePaymentId));
    if (!rule.allowed) {
      return NextResponse.json(
        { error: rejectionMessages[rule.code] },
        { status: 409 }
      );
    }

    const updateData: Record<string, unknown> = { status };

    const reason = cancelReason || `Admin status override to ${status}`;

    if (status === "CANCELLED") {
      updateData.cancelledAt = new Date();
      updateData.cancelReason = reason;
    } else if (status === "COMPLETED") {
      updateData.completedAt = new Date();
    }

    const result = await db.$transaction(async (tx) => {
      // Read current state inside transaction; the override decision is
      // re-validated against it so a concurrent payment can't be overwritten.
      const current = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { status: true, stripePaymentId: true },
      });

      const currentRule = nextAdminStatus(current.status, status, Boolean(current.stripePaymentId));
      if (!currentRule.allowed) {
        return { conflict: true as const };
      }

      // Compare-and-set: only applies if status is unchanged since the read.
      const updatedRows = await tx.order.updateMany({
        where: { id, status: current.status },
        data: updateData,
      });

      if (updatedRows.count === 0) {
        return { conflict: true as const };
      }

      const updated = await tx.order.findUniqueOrThrow({
        where: { id },
        include: {
          listing: true,
          buyer: true,
          seller: { include: { user: true } },
        },
      });

      // Restore stock only when transitioning FROM a non-fulfilled status
      const noRestoreStatuses = ["CANCELLED", "DECLINED", "COMPLETED"];
      if ((status === "CANCELLED" || status === "DECLINED") && order.listingId && !noRestoreStatuses.includes(current.status)) {
        await tx.eggListing.update({
          where: { id: order.listingId },
          data: { stockCount: { increment: order.quantity } },
        });
      }

      await logOrderStatusChange({
        orderId: id,
        fromStatus: current.status,
        toStatus: status,
        changedBy: userId,
        changedByType: "ADMIN",
        reason,
        tx,
      });

      return { conflict: false as const, updated, checkoutSessionId: order.checkoutSessionId };
    });

    if (result.conflict) {
      return NextResponse.json(
        { error: "Order was updated concurrently; please reload and retry" },
        { status: 409 }
      );
    }

    // Eligible cancellation: an open checkout session must no longer be payable.
    if ((status === "CANCELLED" || status === "DECLINED") && result.checkoutSessionId) {
      after(async () => {
        await expireCheckoutSession(result.checkoutSessionId!);
      });
    }

    return NextResponse.json(result.updated);
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}