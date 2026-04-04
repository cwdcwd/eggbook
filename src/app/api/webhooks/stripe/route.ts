import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

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
    console.error("Webhook signature verification failed:", err);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  // Handle events
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        await db.order.update({
          where: { id: orderId },
          data: {
            status: "PAID",
            stripePaymentId: session.payment_intent as string,
            paidAt: new Date(),
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
          await db.$transaction([
            db.order.update({
              where: { id: order.id },
              data: {
                status: "CANCELLED",
                cancelledAt: new Date(),
                cancelReason: "Refunded",
              },
            }),
            db.eggListing.update({
              where: { id: order.listingId },
              data: {
                stockCount: { increment: order.quantity },
              },
            }),
          ]);
        }
      }
      break;
    }
  }

  return new Response("OK", { status: 200 });
}
