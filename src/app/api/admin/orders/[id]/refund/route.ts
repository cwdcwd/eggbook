import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createRefund, stripe } from "@/lib/stripe";
import { verifyAdmin } from "@/lib/auth";
import { AdminRefundSchema } from "@/lib/schemas";
import { logOrderStatusChange } from "@/lib/order-audit";
import { applyRefundReconciliation } from "@/lib/refund-reconciliation";
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
    const outcome = await db.$transaction(async (tx) =>
      applyRefundReconciliation(
        {
          id,
          status: order.status,
          refundedCents: order.refundedCents,
          listingId: order.listingId,
          quantity: order.quantity,
        },
        transition,
        {
          // Apply the shared guarded spec verbatim; a concurrent webhook
          // reconciliation or seller transition makes this a no-op and the
          // manual-reconciliation path below surfaces it.
          updateOrderGuarded: async (spec) => {
            const rows = await tx.order.updateMany(spec);
            return rows.count;
          },
          restoreStock: async (listingId, quantity) => {
            await tx.eggListing.update({
              where: { id: listingId },
              data: { stockCount: { increment: quantity } },
            });
          },
          logAudit: async (entry) => {
            await logOrderStatusChange({
              orderId: id,
              fromStatus: entry.fromStatus,
              toStatus: entry.toStatus,
              changedBy: userId,
              changedByType: "ADMIN",
              reason: cancelReason,
              metadata: {
                stripeRefundId: refund.id,
                refundedCents: entry.refundedCents,
                cumulativeRefunded: charge.amount_refunded,
              },
              tx,
            });
          },
        },
        { cancelReason }
      )
    );

    if (!outcome.applied) {
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
      refundedCents: outcome.refundedCents,
      orderStatus: outcome.orderStatus,
    });
  } catch (error) {
    console.error("Error issuing refund:", error);
    return NextResponse.json(
      { error: "Failed to issue refund" },
      { status: 500 }
    );
  }
}