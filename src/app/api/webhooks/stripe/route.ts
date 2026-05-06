import { headers } from "next/headers";
import { after } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { logOrderStatusChange } from "@/lib/order-audit";
import { notifyUser } from "@/lib/beams-server";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  // Rate limit by IP
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rl = await rateLimit(ip, "webhook");
  if (!rl.success) return rl.response;

  const body = await req.text();
  const signature = headersList.get("stripe-signature");

  console.log("[stripe-webhook] Received request, signature present:", !!signature);

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Parse thin event notification (Stripe endpoint configured with "Thin" payload style)
  let notification: Stripe.Events.UnknownEventNotification;
  try {
    notification = stripe.parseEventNotification(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    ) as Stripe.Events.UnknownEventNotification;
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  const eventType = notification.type;
  const eventId = notification.id;
  console.log(`[stripe-webhook] Verified event: ${eventType} (${eventId})`);

  // With thin events, we need to fetch the full object from Stripe API
  // V1 events may arrive with or without "v1." prefix in thin mode
  const normalizedType = eventType.startsWith("v1.") ? eventType.slice(3) : eventType;

  switch (normalizedType) {
    case "checkout.session.completed": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) {
        console.log(`[stripe-webhook] checkout.session.completed - no related_object id`);
        break;
      }

      const session = await stripe.checkout.sessions.retrieve(relatedId);
      const orderId = session.metadata?.orderId;
      console.log(`[stripe-webhook] checkout.session.completed - orderId: ${orderId}`);

      if (orderId) {
        // Idempotency guard: only update if order hasn't already been paid
        const existingOrder = await db.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });

        if (existingOrder?.status === "PAID" || existingOrder?.status === "COMPLETED") {
          console.log(`[stripe-webhook] Order ${orderId} already ${existingOrder.status}, skipping`);
          break;
        }

        await db.order.update({
          where: { id: orderId },
          data: {
            status: "PAID",
            stripePaymentId: session.payment_intent as string,
            paidAt: new Date(),
          },
        });

        // Log status change to audit trail
        await logOrderStatusChange({
          orderId,
          fromStatus: existingOrder?.status || null,
          toStatus: "PAID",
          changedByType: "SYSTEM",
          reason: "Payment completed via Stripe",
          metadata: {
            stripeEventId: eventId,
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent,
          },
        });

        // Update seller's monthly volume
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
      break;
    }

    case "account.updated":
    case "v2.core.account.updated":
    case "v2.core.account[identity].updated": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) break;

      const account = await stripe.accounts.retrieve(relatedId);
      console.log(`[stripe-webhook] account event - id: ${account.id}, charges_enabled: ${account.charges_enabled}, details_submitted: ${account.details_submitted}`);
      if (account.charges_enabled && account.details_submitted) {
        await db.sellerProfile.updateMany({
          where: { stripeAccountId: account.id },
          data: { stripeOnboarded: true },
        });
      }
      break;
    }

    case "payment_intent.succeeded": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) {
        console.log(`[stripe-webhook] payment_intent.succeeded - no related_object id`);
        break;
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(relatedId);
      const piOrderId = paymentIntent.metadata?.orderId;
      console.log(`[stripe-webhook] payment_intent.succeeded - orderId: ${piOrderId}, pi: ${paymentIntent.id}`);

      if (piOrderId) {
        // Fallback: update order if checkout.session.completed didn't fire or was missed
        const existingOrder = await db.order.findUnique({
          where: { id: piOrderId },
          select: { status: true },
        });

        if (existingOrder && existingOrder.status === "CONFIRMED") {
          await db.order.update({
            where: { id: piOrderId },
            data: {
              status: "PAID",
              stripePaymentId: paymentIntent.id,
              paidAt: new Date(),
            },
          });

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
          console.log(`[stripe-webhook] Order ${piOrderId} updated to PAID via payment_intent fallback`);
        } else {
          console.log(`[stripe-webhook] Order ${piOrderId} status is ${existingOrder?.status}, no update needed`);
        }
      }
      break;
    }

    case "charge.refunded": {
      const relatedId = notification.related_object?.id;
      if (!relatedId) break;

      const charge = await stripe.charges.retrieve(relatedId);
      const paymentIntentId = charge.payment_intent as string;

      if (paymentIntentId) {
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

            // Log status change to audit trail
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
      break;
    }

    default:
      console.log(`[stripe-webhook] Unhandled event type: ${eventType} (normalized: ${normalizedType})`);
  }

  return new Response("OK", { status: 200 });
}
