import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { verifyAdmin } from "@/lib/auth";
import { AdminOrderStatusSchema } from "@/lib/schemas";
import { logOrderStatusChange } from "@/lib/order-audit";
import { expireCheckoutSession } from "@/lib/stripe";
import { nextAdminStatus, type AdminStatusRejectionCode } from "@/lib/payment-integrity";
import { runGuardedOrderTransition } from "@/lib/order-transition";
import { Prisma } from "@prisma/client";

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

    // The session-expiry hook only RECORDS inside the transaction and is
    // dispatched after the response, so a rollback can never leave an expiry
    // scheduled for an order that was not actually cancelled.
    let expireSessionId: string | null = null;

    const result = await db.$transaction(async (tx) =>
      runGuardedOrderTransition({
        orderId: id,
        ports: {
          // Read current state inside transaction; the override decision is
          // re-validated against it so a concurrent payment can't be overwritten.
          findCurrent: (orderId) =>
            tx.order.findUniqueOrThrow({
              where: { id: orderId },
              select: { status: true, stripePaymentId: true },
            }),
          applyTransition: (spec) =>
            tx.order
              .updateMany({
                where: { id: spec.where.id, status: spec.where.status },
                data: spec.data as Prisma.OrderUpdateManyArgs["data"],
              })
              .then((res) => res.count),
          readAfterTransition: (orderId) =>
            tx.order.findUniqueOrThrow({
              where: { id: orderId },
              include: {
                listing: true,
                buyer: true,
                seller: { include: { user: true } },
              },
            }),
          expireSession: (sessionId) => {
            expireSessionId = sessionId;
            return Promise.resolve();
          },
        },
        plan: (current) => {
          const currentRule = nextAdminStatus(current.status, status, Boolean(current.stripePaymentId));
          if (!currentRule.allowed) {
            return null; // becomes the shared conflict outcome
          }
          return {
            toStatus: status,
            data: updateData,
          };
        },
        onApplied: async ({ current, plan: appliedPlan }) => {
          // Restore stock only when transitioning FROM a non-fulfilled status
          const noRestoreStatuses = ["CANCELLED", "DECLINED", "COMPLETED"];
          if (
            (appliedPlan.toStatus === "CANCELLED" || appliedPlan.toStatus === "DECLINED") &&
            order.listingId &&
            !noRestoreStatuses.includes(current.status)
          ) {
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
        },
      })
    );

    if (!result.applied) {
      return NextResponse.json(
        { error: "Order was updated concurrently; please reload and retry" },
        { status: 409 }
      );
    }

    // Eligible cancellation: the session snapshot taken AFTER the successful
    // CAS (see the flow module) must no longer be payable.
    if (expireSessionId) {
      const sessionId = expireSessionId;
      after(async () => {
        await expireCheckoutSession(sessionId);
      });
    }

    return NextResponse.json(result.row);
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}