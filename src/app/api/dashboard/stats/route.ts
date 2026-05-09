import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { clerkId: userId },
    include: { sellerProfile: true },
  });

  if (!user?.sellerProfile) {
    return NextResponse.json({
      totalListings: 0,
      activeListings: 0,
      pendingOrders: 0,
      completedOrders: 0,
      monthlyRevenue: 0,
      feeTier: "FREE",
    });
  }

  const sellerId = user.sellerProfile.id;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const startOfMonth = new Date(year, month - 1, 1);

  const [totalListings, activeListings, pendingOrders, completedOrders, volume] =
    await Promise.all([
      db.eggListing.count({ where: { sellerId } }),
      db.eggListing.count({ where: { sellerId, isAvailable: true } }),
      db.order.count({
        where: { sellerId, status: { in: ["PENDING", "CONFIRMED"] } },
      }),
      db.order.count({
        where: { sellerId, status: "COMPLETED", completedAt: { gte: startOfMonth } },
      }),
      db.sellerMonthlyVolume.findUnique({
        where: { sellerId_month_year: { sellerId, month, year } },
      }),
    ]);

  return NextResponse.json({
    totalListings,
    activeListings,
    pendingOrders,
    completedOrders,
    monthlyRevenue: volume?.totalSales || 0,
    feeTier: volume?.feeTier || "FREE",
  });
}
