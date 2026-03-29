import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createRefund } from "@/lib/stripe";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Admin middleware helper
async function verifyAdmin(userId: string) {
  const user = await db.user.findUnique({
    where: { clerkId: userId },
  });
  return user?.role === "ADMIN";
}

// Issue a refund for an order
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await verifyAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { amount, reason } = body; // amount in dollars, optional partial refund

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

    // Calculate refund amount in cents
    const refundAmountCents = amount
      ? Math.round(parseFloat(amount) * 100)
      : undefined; // undefined = full refund

    // Issue refund via Stripe
    const refund = await createRefund(order.stripePaymentId, refundAmountCents);

    // Update order status
    await db.order.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason || "Refund issued by admin",
      },
    });

    // Restore stock
    await db.eggListing.update({
      where: { id: order.listingId },
      data: {
        stockCount: { increment: order.quantity },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Refund issued successfully",
      refundId: refund.id,
      amount: refund.amount / 100,
    });
  } catch (error) {
    console.error("Error issuing refund:", error);
    return NextResponse.json(
      { error: "Failed to issue refund" },
      { status: 500 }
    );
  }
}
