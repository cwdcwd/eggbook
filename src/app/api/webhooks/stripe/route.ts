import { headers } from "next/headers";
import { after } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { logOrderStatusChange } from "@/lib/order-audit";
import { notifyUser } from "@/lib/beams-server";


// --- Shared business logic helpers ---

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventId: string
) {
  const orderId = session.metadata?.orderId;
  console.log(`[stripe-webhook] checkout.session.completed - orderId: ${orderId}`);

  if (!orderId) return;

  // Only transition from CONFIRMED → PAID (the expected pre-payment status)
  // If the seller has already manually advanced the order (PAID/COMPLETED),
  // still record Stripe payment details but don't change the status
  const existingOrder = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true, stripePaymentId: true },
  });

  if (!existingOrder) {
    console.log(`[stripe-webhook] Order ${orderId} not found — skipping`);
    return;
  }

  const validStatuses = ["CONFIRMED", "PAID", "COMPLETED"];
  if (!validStatuses.includes(existingOrder.status)) {
    console.log(`[stripe-webhook] Order ${orderId} status is ${existingOrder.status}, not in ${validStatuses.join("/")} — skipping`);
    return;
  }

  // Atomically set stripePaymentId only if not already set (idempotency guard).
  // This ensures volume/notification logic runs exactly once per payment.
  const updated = await db.order.updateMany({
    where: { id: orderId, stripePaymentId: null },
    data: {
      ...(existingOrder.status === "CONFIRMED" && { status: "PAID" }),
      stripePaymentId: session.payment_intent as string,
      paidAt: new Date(),
    },
  });

  if (updated.count === 0) {
    console.log(`[stripe-webhook] Order ${orderId} stripePaymentId already set — skipping (idempotent)`);
    return;
  }

  if (existingOrder.status === "CONFIRMED") {
    await logOrderStatusChange({
      orderId,
      fromStatus: "CONFIRMED",
      toStatus: "PAID",
      changedByType: "SYSTEM",
      reason: "Payment completed via Stripe",
      metadata: {
        stripeEventId: eventId,
        stripeSessionId: session.id,
        stripePaymentIntentId: session.payment_intent,
      },
    });
  }

  // Update seller's monthly volume and notify
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { seller: { include: { user: true } } },
  });

  if (order) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    await db.sellerMonthlyVolume.upsert({
      where: {
        sellerId_month_year: {
          sellerId: order.sellerId,
          month,
          year,
        },
      },
      update: {
        totalSales: { increment: order.totalPrice },
      },
      create: {
        sellerId: order.sellerId,
        month,
        year,
        totalSales: order.totalPrice,
        feeTier: "FREE",
      },
    });

    // Update fee tier based on new total
    const volume = await db.sellerMonthlyVolume.findUnique({
      where: {
        sellerId_month_year: {
          sellerId: order.sellerId,
          month,
          year,
        },
      },
    });

    if (volume) {
      let newTier: "FREE" | "STARTER" | "PRO" = "FREE";
      if (volume.totalSales > 2000) newTier = "PRO";
      else if (volume.totalSales > 500) newTier = "STARTER";

      await db.sellerMonthlyVolume.update({
        where: { id: volume.id },
        data: { feeTier: newTier },
      });
    }

    // Notify seller that payment was received (runs after response)
    after(async () => {
      await notifyUser(order.seller.user.clerkId, {
        title: "Payment Received",
        body: `Order #${orderId.slice(-6)} has been paid ($${order.totalPrice.toFixed(2)})`,
        deepLink: `/dashboard/orders`,
      });
    });
  }
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  eventId: string
) {
  const piOrderId = paymentIntent.metadata?.orderId;
  console.log(`[stripe-webhook] payment_intent.succeeded - orderId: ${piOrderId}, pi: ${paymentIntent.id}`);

  if (!piOrderId) return;

  // Fallback: update order if checkout.session.completed didn't fire or was missed
  const existingOrder = await db.order.findUnique({
    where: { id: piOrderId },
    select: { status: true, stripePaymentId: true },
  });

  if (!existingOrder) return;

  const validStatuses = ["CONFIRMED", "PAID", "COMPLETED"];
  if (!validStatuses.includes(existingOrder.status)) return;

  // Atomically set stripePaymentId only if not already set
  const updated = await db.order.updateMany({
    where: { id: piOrderId, stripePaymentId: null },
    data: {
      ...(existingOrder.status === "CONFIRMED" && { status: "PAID" }),
      stripePaymentId: paymentIntent.id,
      paidAt: new Date(),
    },
  });

  if (updated.count === 0) {
    console.log(`[stripe-webhook] Order ${piOrderId} stripePaymentId already set — skipping (idempotent)`);
    return;
  }

  if (existingOrder.status === "CONFIRMED") {
    await logOrderStatusChange({
      orderId: piOrderId,
      fromStatus: "CONFIRMED",
      toStatus: "PAID",
      changedByType: "SYSTEM",
      reason: "Payment completed via Stripe (payment_intent.succeeded fallback)",
      metadata: {
        stripeEventId: eventId,
        stripePaymentIntentId: paymentIntent.id,
      },
    });
  }

  console.log(`[stripe-webhook] Order ${piOrderId} updated via payment_intent fallback`);
}

async function handleChargeRefunded(charge: Stripe.Charge, eventId: string) {
  const paymentIntentId = charge.payment_intent as string;
  if (!paymentIntentId) return;

  // Find the order that hasn't been cancelled yet (idempotency guard)
  const order = await db.order.findFirst({
    where: {
      stripePaymentId: paymentIntentId,
      status: { not: "CANCELLED" },
    },
  });

  if (order) {
    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: "Refunded",
        },
      });
      await tx.eggListing.update({
        where: { id: order.listingId },
        data: {
          stockCount: { increment: order.quantity },
        },
      });

      await logOrderStatusChange({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: "CANCELLED",
        changedByType: "SYSTEM",
        reason: "Refunded via Stripe",
        metadata: {
          stripeEventId: eventId,
          stripeChargeId: charge.id,
          stripePaymentIntentId: paymentIntentId,
        },
        tx,
      });
    });
  }
}

async function handleAccountUpdated(account: Stripe.Account) {
  console.log(`[stripe-webhook] account event - id: ${account.id}, charges_enabled: ${account.charges_enabled}, details_submitted: ${account.details_submitted}`);
  if (account.charges_enabled && account.details_submitted) {
    await db.sellerProfile.updateMany({
      where: { stripeAccountId: account.id },
      data: { stripeOnboarded: true },
    });
  }
}

// --- Route handler ---

export async function POST(req: Request) {
  const headersList = await headers();

  const body = await req.text();
  const signature = headersList.get("stripe-signature");

  console.log("[stripe-webhook] Received request, signature present:", !!signature);

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Try classic (full payload) format first, then thin event format as fallback.
  // Classic webhooks use STRIPE_WEBHOOK_SECRET; thin event destinations use STRIPE_WEBHOOK_SECRET_THIN.
  const classicSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const thinSecret = process.env.STRIPE_WEBHOOK_SECRET_THIN;

  // Attempt 1: Classic full-payload webhook (v1 events like checkout.session.completed)
  if (classicSecret) {
    try {
      const event = stripe.webhooks.constructEvent(body, signature, classicSecret);
      console.log(`[stripe-webhook] Classic event verified: ${event.type} (${event.id})`);
      await handleClassicEvent(event);
      return new Response("OK", { status: 200 });
    } catch (err) {
      // If thin secret is also configured, this might be a thin event — continue to fallback
      if (thinSecret) {
        console.log("[stripe-webhook] Classic verification failed, trying thin format...");
      } else {
        console.error("[stripe-webhook] Signature verification failed:", err);
        return new Response("Webhook signature verification failed", { status: 400 });
      }
    }
  }

  // Attempt 2: Thin event notification (v2 events like account.updated)
  if (thinSecret) {
    try {
      const notification = stripe.parseEventNotification(
        body,
        signature,
        thinSecret
      ) as Stripe.Events.UnknownEventNotification;

      const eventType = notification.type;
      const eventId = notification.id;
      console.log(`[stripe-webhook] Thin event verified: ${eventType} (${eventId})`);

      await handleThinEvent(notification, eventId);
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("[stripe-webhook] Thin event signature verification failed:", err);
      return new Response("Webhook signature verification failed", { status: 400 });
    }
  }

  console.error("[stripe-webhook] No webhook secret configured (STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_THIN)");
  return new Response("Webhook secret not configured", { status: 500 });
}

// --- Classic (full payload) event handling ---

async function handleClassicEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session, event.id);
      break;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentIntentSucceeded(paymentIntent, event.id);
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await handleChargeRefunded(charge, event.id);
      break;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await handleAccountUpdated(account);
      break;
    }

    default:
      console.log(`[stripe-webhook] Unhandled classic event type: ${event.type}`);
  }
}

// --- Thin event notification handling ---

async function handleThinEvent(
  notification: Stripe.Events.UnknownEventNotification,
  eventId: string
) {
  const eventType = notification.type;
  // V1 events may arrive with "v1." prefix in thin mode
  const normalizedType = eventType.startsWith("v1.") ? eventType.slice(3) : eventType;

  switch (normalizedType) {
    case "checkout.session.completed": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) {
        console.log(`[stripe-webhook] checkout.session.completed - no related_object id`);
        break;
      }
      const session = await stripe.checkout.sessions.retrieve(relatedId);
      await handleCheckoutCompleted(session, eventId);
      break;
    }

    case "payment_intent.succeeded": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) {
        console.log(`[stripe-webhook] payment_intent.succeeded - no related_object id`);
        break;
      }
      const paymentIntent = await stripe.paymentIntents.retrieve(relatedId);
      await handlePaymentIntentSucceeded(paymentIntent, eventId);
      break;
    }

    case "charge.refunded": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) break;
      const charge = await stripe.charges.retrieve(relatedId);
      await handleChargeRefunded(charge, eventId);
      break;
    }

    case "account.updated":
    case "v2.core.account.updated":
    case "v2.core.account[identity].updated": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) break;
      const account = await stripe.accounts.retrieve(relatedId);
      await handleAccountUpdated(account);
      break;
    }

    default:
      console.log(`[stripe-webhook] Unhandled thin event type: ${eventType} (normalized: ${normalizedType})`);
  }
}
