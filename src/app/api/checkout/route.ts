import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createCheckoutSession } from "@/lib/stripe";
import { getOrCreateUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 });
    }

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

    // Check order status (must be CONFIRMED)
    if (order.status !== "CONFIRMED") {
      return NextResponse.json(
        { error: "Order must be confirmed by seller before payment" },
        { status: 400 }
      );
    }

    // Check seller has Stripe connected (skip in dev if STRIPE_CONNECT_ENABLED=false)
    const connectEnabled = process.env.STRIPE_CONNECT_ENABLED !== 'false'
    if (connectEnabled && (!order.seller.stripeAccountId || !order.seller.stripeOnboarded)) {
      return NextResponse.json(
        { error: "Seller has not completed payment setup" },
        { status: 400 }
      );
    }

    // Create Stripe checkout session
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const amountInCents = Math.round(order.totalPrice * 100);
    const platformFeeInCents = Math.round(order.platformFee * 100);

    // Use seller's Stripe account if Connect is enabled and they're onboarded
    const sellerAccount = connectEnabled && order.seller.stripeOnboarded 
      ? order.seller.stripeAccountId 
      : null;

    const session = await createCheckoutSession(
      order.id,
      amountInCents,
      sellerAccount,
      platformFeeInCents,
      `${baseUrl}/checkout/${order.id}/success`,
      `${baseUrl}/checkout/${order.id}`
    );

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
