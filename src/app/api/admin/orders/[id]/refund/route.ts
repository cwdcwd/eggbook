import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createRefund, stripe } from "@/lib/stripe";
import { verifyAdmin } from "@/lib/auth";
import { AdminRefundSchema } from "@/lib/schemas";
import { logOrderStatusChange } from "@/lib/order-audit";
import {
  applyCumulativeRefund,
  centsToDollars,
  dollarsToCents,
} from "@/lib/payment-integrity";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Issue a refund for an order
export async function POST(req: NextRequest, { params }: RouteParams) {
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
    const parsed = AdminRefundSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
    }
    const { amount, reason } = parsed.data;

    const order = await db.order.findUnique({
      where: { id },
      include: {
        listing: true,
        buyer: true,
        seller: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Must have a payment to refund
    if (!order.stripePaymentId) {
      return NextResponse.json(
        { error: "Order has no payment to refund" },
        { status: 400 }
      );
    }

    // Must be in a refundable status
    if (!["PAID", "COMPLETED"].includes(order.status)) {
      return NextResponse.json(
        { error: "Order cannot be refunded in current status" },
        { status: 400 }
      );
    }

    // Exact integer-cent accounting
    let orderAmountCents: number;
    let refundAmountCents: number | undefined;
    try {
      orderAmountCents = dollarsToCents(order.totalPrice);
      if (amount != null) {
        refundAmountCents = dollarsToCents(amount);
      }
    } catch {
      return NextResponse.json(
        { error: "Refund amount must be a whole-cent amount" },
        { status: 400 }
      );
    }

    // Over-refund guard BEFORE touching Stripe
    const remainingCents = orderAmountCents - order.refundedCents;
    if (remainingCents <= 0) {
      return NextResponse.json(
        { error: "Order has already been fully refunded" },
        { status: 400 }
      );
    }
    if (refundAmountCents != null && refundAmountCents > remainingCents) {
      return NextResponse.json(
        {
          error: `Refund exceeds remaining amount ($${centsToDollars(remainingCents).toFixed(2)} available)`,
        },
        { status: 400 }
      );
    }

    // Issue refund via Stripe (undefined = rest of the payment)
    const refund = await createRefund(order.stripePaymentId, refundAmountCents);

    // Reconcile from Stripe's cumulative truth (charge.amount_refunded) so a
    // refund issued through the dashboard at any point is also accounted for.
    const charge = await stripe.charges.retrieve(refund.charge as string);
    if (charge.amount_refunded == null) {
      return NextResponse.json(
        { error: "Refund issued; reconciliation requires manual review" },
        { status: 500 }
      );
    }
    let transition;
    try {
      transition = applyCumulativeRefund(
        {
          status: order.status,
          amountCents: orderAmountCents,
          refundedCents: order.refundedCents,
        },
        Math.min(charge.amount_refunded, orderAmountCents)
      );
    } catch (error) {
      console.error("Refund exceeds order total:", error);
      return NextResponse.json(
        { error: "Refund issued; reconciliation requires manual review" },
        { status: 500 }
      );
    }

    if (!transition) {
      // Stripe reports the payment as already reconciled (or this is a replay) —
      // the money has been refunded, so record the event and report success.
      await logOrderStatusChange({
        orderId: id,
        fromStatus: order.status,
        toStatus: order.status,
        changedBy: userId,
        changedByType: "ADMIN",
        reason: reason || "Refund issued by admin",
        metadata: {
          stripeRefundId: refund.id,
          stripeEventReconciled: true,
        },
      });
      return NextResponse.json({
        success: true,
        message: "Refund issued successfully",
        refundId: refund.id,
        amount: centsToDollars(refund.amount),
        refundedCents: order.refundedCents,
      });
    }

    // Update order status, refund balance, restore stock, and log audit trail
    // in one guarded transaction: only applies from the state we reconciled,
    // so it runs exactly once even against concurrent webhook reconciliation.
    const cancelReason = reason || "Refund issued by admin";
    const updatedRows = await db.$transaction(async (tx) => {
      const rows = await tx.order.updateMany({
        where: {
          id,
          status: order.status,
          refundedCents: order.refundedCents,
        },
        data: {
          status: transition.status,
          refundedCents: transition.refundedCents,
          ...(transition.status === "CANCELLED" && {
            cancelledAt: new Date(),
            cancelReason,
          }),
        },
      });

      if (rows.count === 0) {
        return { count: 0 };
      }

      // Restore stock exactly once: only on the transition into CANCELLED, and
      // never for orders that were already fulfilled (COMPLETED).
      if (transition.status === "CANCELLED" && transition.restoreStock && order.status !== "COMPLETED") {
        await tx.eggListing.update({
          where: { id: order.listingId },
          data: {
            stockCount: { increment: order.quantity },
          },
        });
      }

      await logOrderStatusChange({
        orderId: id,
        fromStatus: order.status,
        toStatus: transition.status,
        changedBy: userId,
        changedByType: "ADMIN",
        reason: cancelReason,
        metadata: {
          stripeRefundId: refund.id,
          refundedCents: transition.refundedCents,
          cumulativeRefunded: charge.amount_refunded,
        },
        tx,
      });
      return { count: rows.count };
    });

    if (updatedRows.count === 0) {
      // Money has moved; record what happened so a human can reconcile.
      await logOrderStatusChange({
        orderId: id,
        fromStatus: order.status,
        toStatus: order.status,
        changedBy: userId,
        changedByType: "ADMIN",
        reason: "Refund recorded but order changed concurrently; manual reconciliation required",
        metadata: {
          stripeRefundId: refund.id,
          attemptedStatus: transition.status,
          attemptedRefundedCents: transition.refundedCents,
        },
      });
      return NextResponse.json(
        { error: "Refund issued; order changed concurrently and requires manual reconciliation" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Refund issued successfully",
      refundId: refund.id,
      amount: centsToDollars(refund.amount),
      refundedCents: transition.refundedCents,
      orderStatus: transition.status,
    });
  } catch (error) {
    console.error("Error issuing refund:", error);
    return NextResponse.json(
      { error: "Failed to issue refund" },
      { status: 500 }
    );
  }
}