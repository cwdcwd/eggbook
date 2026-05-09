import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle, Clock, AlertCircle } from "lucide-react";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { logOrderStatusChange } from "@/lib/order-audit";
import { Button, Card } from "@/components/ui";

export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { orderId } = await params;
  const { session_id } = await searchParams;
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  let order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      totalPrice: true,
      buyer: { select: { clerkId: true } },
      listing: { select: { title: true } },
    },
  });

  // If order doesn't exist or doesn't belong to this user, redirect
  if (!order || order.buyer.clerkId !== userId) {
    redirect("/dashboard");
  }

  // Fallback: if the webhook hasn't fired yet, check Stripe directly
  if (order.status === "CONFIRMED" && session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);

      // Verify this session actually belongs to this order
      if (
        session.metadata?.orderId === orderId &&
        session.payment_status === "paid"
      ) {
        // Conditionally update only if status is still CONFIRMED (idempotent)
        const updated = await db.order.updateMany({
          where: { id: orderId, status: "CONFIRMED" },
          data: {
            status: "PAID",
            stripePaymentId: session.payment_intent as string,
            paidAt: new Date(),
          },
        });

        // Only log if we actually changed the status
        if (updated.count > 0) {
          await logOrderStatusChange({
            orderId,
            fromStatus: "CONFIRMED",
            toStatus: "PAID",
            changedByType: "SYSTEM",
            reason: "Payment confirmed via Stripe API (webhook fallback)",
            metadata: {
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent,
            },
          });
        }

        // Re-fetch to get updated status
        order = await db.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            totalPrice: true,
            buyer: { select: { clerkId: true } },
            listing: { select: { title: true } },
          },
        });

        if (!order) redirect("/dashboard");
      }
    } catch (err) {
      console.error("[checkout-success] Stripe fallback check failed:", err);
      // Non-fatal: page still renders with current DB status
    }
  }

  if (!order) redirect("/dashboard");

  const isPaid = order.status === "PAID" || order.status === "COMPLETED";
  const isProcessing = order.status === "CONFIRMED";

  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
      <Card className="p-8 text-center max-w-md">
        {isPaid ? (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-amber-900 mb-2">
              Payment Successful!
            </h1>
            <p className="text-amber-600 mb-6">
              Your order for <span className="font-medium">{order.listing.title}</span> has been paid (${order.totalPrice.toFixed(2)}). The seller will contact you soon to arrange pickup or delivery.
            </p>
          </>
        ) : isProcessing ? (
          <>
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-amber-900 mb-2">
              Payment Processing
            </h1>
            <p className="text-amber-600 mb-6">
              Your payment is being confirmed. This usually takes just a moment. You can check your order status from the dashboard.
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-amber-900 mb-2">
              Payment Issue
            </h1>
            <p className="text-amber-600 mb-6">
              There was an issue with your payment. Please check your order status or contact support.
            </p>
          </>
        )}
        <div className="flex flex-col gap-3">
          <Link href="/dashboard/orders">
            <Button className="w-full">View Orders</Button>
          </Link>
          <Link href="/messages">
            <Button variant="outline" className="w-full">
              Message Seller
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
