import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createCheckoutSession, expireCheckoutSession, stripe } from "@/lib/stripe";
import { getOrCreateUser } from "@/lib/auth";
import { CheckoutSchema } from "@/lib/schemas";
import { dollarsToCents } from "@/lib/payment-integrity";
import { createCheckoutForOrder, type CheckoutFlowResult, type CheckoutSessionPorts } from "@/lib/checkout-session";

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

    // The full decision flow (idempotency, session claim, race handling) lives
    // in the checkout-session flow module; these ports bind it to the real
    // Prisma + Stripe surfaces. The claim spec is built by the shared integrity
    // module and applied verbatim, so the order-status guard on the session
    // claim matches the one the regression suite exercises.
    const ports: CheckoutSessionPorts = {
      findOrder: async (id) =>
        db.order.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            stripePaymentId: true,
            checkoutSessionId: true,
          },
        }),
      retrieveSession: async (sessionId) => {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          return { id: session.id, url: session.url, status: session.status ?? null };
        } catch (error) {
          console.warn(`Retrieving checkout session ${sessionId} failed`, error);
          return null;
        }
      },
      createSession: async (input) =>
        createCheckoutSession(
          input.orderId,
          input.amountCents,
          input.sellerAccount,
          input.platformFeeCents,
          `${input.baseUrl}/checkout/${input.orderId}/success?session_id={CHECKOUT_SESSION_ID}`,
          `${input.baseUrl}/checkout/${input.orderId}`
        ),
      claimSession: async (spec) => {
        const claim = await db.order.updateMany(spec);
        return claim.count;
      },
      expireSession: async (sessionId) => {
        await expireCheckoutSession(sessionId);
      },
    };

    const result = await createCheckoutForOrder(
      {
        orderId: order.id,
        amountCents: amountInCents,
        platformFeeCents: platformFeeInCents,
        sellerAccount,
        baseUrl,
      },
      ports
    );

    const json = (res: CheckoutFlowResult) =>
      res.kind === "url"
        ? NextResponse.json({ url: res.url })
        : NextResponse.json({ error: res.error }, { status: res.status });
    return json(result);
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}