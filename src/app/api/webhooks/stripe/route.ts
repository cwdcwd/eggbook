import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { logOrderStatusChange } from "@/lib/order-audit";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  console.log("[stripe-webhook] Received request, signature present:", !!signature);

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  console.log(`[stripe-webhook] Verified event: ${event.type} (${event.id})`);

  // Handle events
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      console.log(`[stripe-webhook] checkout.session.completed - orderId: ${orderId}`);

      if (orderId) {
        // Idempotency guard: only update if order is in CONFIRMED state
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
            stripeEventId: event.id,
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent,
          },
        });

        // Update seller's monthly volume
        const order = await db.order.findUnique({
          where: { id: orderId },
          include: { seller: true },
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
        }
      }
      break;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      
      if (account.charges_enabled && account.details_submitted) {
        await db.sellerProfile.updateMany({
          where: { stripeAccountId: account.id },
          data: { stripeOnboarded: true },
        });
      }
      break;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
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
              stripeEventId: event.id,
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
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = charge.payment_intent as string;

      if (paymentIntentId) {
        // Find the order that hasn't been cancelled yet (idempotency guard)
        const order = await db.order.findFirst({
          where: {
            stripePaymentId: paymentIntentId,
            status: { not: "CANCELLED" }, // Only process if not already cancelled
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
                stripeEventId: event.id,
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
  }

  return new Response("OK", { status: 200 });
}
