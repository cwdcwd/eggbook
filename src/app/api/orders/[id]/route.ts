import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { OrderStatus } from "@prisma/client";
import { logOrderStatusChange } from "@/lib/order-audit";
import { triggerOrderUpdate } from "@/lib/pusher";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Get a single order
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const order = await db.order.findUnique({
      where: { id },
      include: {
        listing: {
          include: {
            tags: true,
          },
        },
        buyer: true,
        seller: {
          include: { user: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check authorization (must be buyer or seller of order)
    const isBuyer = order.buyerId === user.id;
    const isSeller = user.sellerProfile?.id === order.sellerId;

    if (!isBuyer && !isSeller) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}

// Update order status
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const order = await db.order.findUnique({
      where: { id },
      include: {
        listing: true,
        seller: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const body = await req.json();
    const { action, cancelReason } = body;

    const isBuyer = order.buyerId === user.id;
    const isSeller = user.sellerProfile?.id === order.sellerId;

    // Define allowed transitions and who can make them
    const transitions: Record<string, { fromStatus: OrderStatus[]; toStatus: OrderStatus; allowedBy: "buyer" | "seller" | "both" }> = {
      confirm: { fromStatus: ["PENDING"], toStatus: "CONFIRMED", allowedBy: "seller" },
      decline: { fromStatus: ["PENDING"], toStatus: "DECLINED", allowedBy: "seller" },
      cancel: { fromStatus: ["PENDING", "CONFIRMED"], toStatus: "CANCELLED", allowedBy: "both" },
      markPaid: { fromStatus: ["CONFIRMED"], toStatus: "PAID", allowedBy: "seller" }, // Manual payment (cash, Venmo, etc.)
      complete: { fromStatus: ["PAID", "CONFIRMED"], toStatus: "COMPLETED", allowedBy: "seller" }, // Can complete directly from CONFIRMED if paid externally
    };

    const transition = transitions[action];
    if (!transition) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Check permission
    const canPerform =
      (transition.allowedBy === "seller" && isSeller) ||
      (transition.allowedBy === "buyer" && isBuyer) ||
      (transition.allowedBy === "both" && (isBuyer || isSeller));

    if (!canPerform) {
      return NextResponse.json({ error: "Not authorized for this action" }, { status: 403 });
    }

    // Check current status allows this transition
    if (!transition.fromStatus.includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot ${action} order in ${order.status} status` },
        { status: 400 }
      );
    }

    // Determine actor type
    const actorType = isSeller ? "SELLER" : "BUYER";

    // Update order and log status change in transaction
    const updatedOrder = await db.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          status: transition.toStatus,
          ...(action === "cancel" && { cancelledAt: new Date(), cancelReason }),
          ...(action === "decline" && { cancelReason }),
          ...(action === "markPaid" && { paidAt: new Date() }), // Manual payment
          ...(action === "complete" && { completedAt: new Date(), ...(!order.paidAt && { paidAt: new Date() }) }), // Set paidAt if completing directly
        },
        include: {
          listing: true,
          buyer: true,
          seller: { include: { user: true } },
        },
      });

      // If declined or cancelled, restore stock
      if (["DECLINED", "CANCELLED"].includes(transition.toStatus)) {
        await tx.eggListing.update({
          where: { id: order.listingId },
          data: {
            stockCount: { increment: order.quantity },
          },
        });
      }

      // Log status change to audit trail
      const auditReason = (() => {
        if (cancelReason) return cancelReason;
        if (action === "markPaid") return "Marked as paid (external payment)";
        if (action === "complete" && order.status === "CONFIRMED") return "Completed with external payment";
        return null;
      })();

      await logOrderStatusChange({
        orderId: id,
        fromStatus: order.status,
        toStatus: transition.toStatus,
        changedBy: userId,
        changedByType: actorType,
        reason: auditReason,
        tx,
      });

      return updated;
    });

    // Notify both buyer and seller about the status change
    const buyerUserId = updatedOrder.buyer.clerkId;
    const sellerUserId = updatedOrder.seller.user.clerkId;

    await Promise.all([
      triggerOrderUpdate(buyerUserId, {
        orderId: updatedOrder.id,
        status: updatedOrder.status,
        message: `Order ${action}ed`,
      }),
      triggerOrderUpdate(sellerUserId, {
        orderId: updatedOrder.id,
        status: updatedOrder.status,
        message: `Order ${action}ed`,
      }),
    ]);

    return NextResponse.json(updatedOrder);
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
