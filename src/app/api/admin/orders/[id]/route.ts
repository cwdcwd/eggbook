import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { verifyAdmin } from "@/lib/auth";
import { AdminOrderStatusSchema } from "@/lib/schemas";
import { logOrderStatusChange } from "@/lib/order-audit";

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

    const updateData: Record<string, unknown> = { status };

    const reason = cancelReason || `Admin status override to ${status}`;

    if (status === "CANCELLED") {
      updateData.cancelledAt = new Date();
      updateData.cancelReason = reason;
    } else if (status === "COMPLETED") {
      updateData.completedAt = new Date();
    }

    const updatedOrder = await db.$transaction(async (tx) => {
      // Read current status inside transaction for accurate audit trail
      const current = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!current) {
        return null;
      }

      const updated = await tx.order.update({
        where: { id },
        data: updateData,
        include: {
          listing: true,
          buyer: true,
          seller: { include: { user: true } },
        },
      });

      // Restore stock only when transitioning FROM a non-terminal/non-fulfilled status
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

      return updated;
    });

    if (!updatedOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(updatedOrder);
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
