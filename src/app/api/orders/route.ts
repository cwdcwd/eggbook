import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { OrderStatus } from "@prisma/client";
import { calculatePlatformFee, calculateFeeTier } from "@/lib/utils";
import { triggerNewOrder } from "@/lib/pusher";
import { getOrCreateUser } from "@/lib/auth";
import { logOrderStatusChange } from "@/lib/order-audit";

// Create a new order
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { listingId, quantity, fulfillmentType, pickupTime, deliveryAddress, deliveryLat, deliveryLng } = body;

    // Get the listing
    const listing = await db.eggListing.findUnique({
      where: { id: listingId },
      include: { seller: { include: { user: true } } },
    });

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (!listing.isAvailable || listing.stockCount < quantity) {
      return NextResponse.json({ error: "Not enough stock" }, { status: 400 });
    }

    // Get buyer
    const buyer = await getOrCreateUser(userId);

    if (!buyer) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Calculate price and fee
    const totalPrice = listing.pricePerUnit * quantity;
    
    // Get seller's current month volume for fee calculation
    const now = new Date();
    const volume = await db.sellerMonthlyVolume.findUnique({
      where: {
        sellerId_month_year: {
          sellerId: listing.sellerId,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        },
      },
    });

    const { feePercent } = calculateFeeTier(volume?.totalSales || 0);
    const platformFee = calculatePlatformFee(totalPrice, feePercent);

    // Create order and decrement stock in a transaction (with atomic check)
    const order = await db.$transaction(async (tx) => {
      // Atomically decrement stock only if sufficient quantity exists
      const updateResult = await tx.eggListing.updateMany({
        where: {
          id: listingId,
          stockCount: { gte: quantity },
          isAvailable: true,
        },
        data: {
          stockCount: { decrement: quantity },
        },
      });

      // Verify stock was actually decremented (handles race condition)
      if (updateResult.count === 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      // Create order (auto-confirm if seller has autoAcceptOrders enabled)
      const initialStatus = listing.seller.autoAcceptOrders ? "CONFIRMED" : "PENDING";
      const newOrder = await tx.order.create({
        data: {
          buyerId: buyer.id,
          sellerId: listing.sellerId,
          listingId: listing.id,
          quantity,
          totalPrice,
          platformFee,
          fulfillmentType,
          status: initialStatus,
          pickupTime: pickupTime ? new Date(pickupTime) : null,
          deliveryAddress,
          deliveryLat,
          deliveryLng,
        },
        include: {
          listing: true,
          buyer: true,
        },
      });

      // Log initial status to audit trail
      await logOrderStatusChange({
        orderId: newOrder.id,
        fromStatus: null,
        toStatus: initialStatus,
        changedBy: userId,
        changedByType: "BUYER",
        reason: listing.seller.autoAcceptOrders ? "Auto-accepted by seller settings" : null,
        tx,
      });

      return newOrder;
    });

    // Notify seller via Pusher (use clerkId for channel subscription)
    await triggerNewOrder(listing.seller.user.clerkId, {
      id: order.id,
      buyerName: buyer.username,
      listingTitle: listing.title,
      quantity,
      totalPrice,
    });

    return NextResponse.json(order);
  } catch (error) {
    // Handle race condition error gracefully
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return NextResponse.json({ error: "Not enough stock" }, { status: 400 });
    }
    console.error("Error creating order:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}

// Get orders for current user
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      // User not synced to database yet - return empty array
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(req.url);
    const role = searchParams.get("role") || "buyer"; // buyer or seller
    const status = searchParams.get("status");
    const uncompleted = searchParams.get("uncompleted") === "true";

    // Build status filter - orders that still need action (not completed, cancelled, or declined)
    const uncompletedStatuses: OrderStatus[] = [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PAID,
    ];

    const getStatusFilter = () => {
      if (uncompleted) {
        return { status: { in: uncompletedStatuses } };
      }
      if (status) {
        return { status: status as OrderStatus };
      }
      return {};
    };

    let orders;

    if (role === "seller" && user.sellerProfile) {
      orders = await db.order.findMany({
        where: {
          sellerId: user.sellerProfile.id,
          ...getStatusFilter(),
        },
        include: {
          listing: true,
          buyer: true,
        },
        orderBy: { createdAt: "desc" },
      });
    } else {
      orders = await db.order.findMany({
        where: {
          buyerId: user.id,
          ...getStatusFilter(),
        },
        include: {
          listing: true,
          seller: {
            include: { user: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    return NextResponse.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
