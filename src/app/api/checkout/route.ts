import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createCheckoutSession, expireCheckoutSession, stripe } from "@/lib/stripe";
import { getOrCreateUser } from "@/lib/auth";
import { CheckoutSchema } from "@/lib/schemas";
import { dollarsToCents, nextCheckoutAction } from "@/lib/payment-integrity";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 });
    }
    const { orderId } = parsed.data;

    // Get user
    const user = await getOrCreateUser(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get order with seller info
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        seller: true,
        listing: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Verify buyer owns this order
    if (order.buyerId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Exact integer-cent amounts (rejects fractional-cent totals outright)
    let amountInCents: number;
    let platformFeeInCents: number;
    try {
      amountInCents = dollarsToCents(order.totalPrice);
      platformFeeInCents = dollarsToCents(order.platformFee);
    } catch {
      return NextResponse.json(
        { error: "Order total must be a whole-cent amount" },
        { status: 400 }
      );
    }

    // If this order already has a stored session, check whether it can still
    // be paid — that makes checkout creation idempotent: retries and refreshes
    // return the same open session instead of stacking up duplicates.
    let sessionStatus: string | null = null;
    if (order.checkoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(order.checkoutSessionId);
        sessionStatus = existing.status ?? null;
      } catch (error) {
        // Unretrievable (deleted/unexpected) — fall through and mint a new one.
        console.warn(`Retrieving stored checkout session for order ${orderId} failed`, error);
        sessionStatus = null;
      }
    }

    const decision = nextCheckoutAction(
      { status: order.status, stripePaymentId: order.stripePaymentId },
      sessionStatus
    );

    if (decision === "reject-paid") {
      return NextResponse.json(
        { error: "Order has already been paid" },
        { status: 409 }
      );
    }
    if (decision === "reject-status") {
      return NextResponse.json(
        { error: "Order must be confirmed by seller before payment" },
        { status: 400 }
      );
    }
    if (decision === "reject-completed-session") {
      return NextResponse.json(
        { error: "A previous checkout session already completed; awaiting payment confirmation" },
        { status: 409 }
      );
    }

    if (decision === "reuse") {
      const session = await stripe.checkout.sessions.retrieve(order.checkoutSessionId!);
      return NextResponse.json({ url: session.url });
    }

    // Use seller's Stripe account if Connect is enabled and they're onboarded
    // Falls back to direct payment in createCheckoutSession if seller lacks capabilities
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Server configuration error: NEXT_PUBLIC_APP_URL not set" },
        { status: 500 }
      );
    }
    const connectEnabled = process.env.STRIPE_CONNECT_ENABLED !== 'false'
    const sellerAccount = connectEnabled && order.seller.stripeOnboarded
      ? order.seller.stripeAccountId
      : null;

    const session = await createCheckoutSession(
      order.id,
      amountInCents,
      sellerAccount,
      platformFeeInCents,
      `${baseUrl}/checkout/${order.id}/success?session_id={CHECKOUT_SESSION_ID}`,
      `${baseUrl}/checkout/${order.id}`
    );

    // Atomically claim the session slot: two racing creators each mint a
    // session, but only the request that wins the compare-and-set keeps it.
    // The loser expires its own session so only one open session remains.
    const claim = await db.order.updateMany({
      where: { id: order.id, checkoutSessionId: order.checkoutSessionId ?? null },
      data: { checkoutSessionId: session.id },
    });

    if (claim.count === 0) {
      void expireCheckoutSession(session.id);
      const winner = await db.order.findUnique({
        where: { id: order.id },
        select: { checkoutSessionId: true },
      });
      if (winner?.checkoutSessionId) {
        try {
          const winSession = await stripe.checkout.sessions.retrieve(winner.checkoutSessionId);
          if (winSession.status === "open") {
            return NextResponse.json({ url: winSession.url });
          }
        } catch {
          // fall through to the race error below
        }
      }
      return NextResponse.json(
        { error: "Checkout session could not be settled; please retry" },
        { status: 409 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}