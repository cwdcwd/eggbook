import Link from "next/link";
import { Package, ShoppingCart, DollarSign, TrendingUp, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@/components/ui";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

// Ensure fresh data on every request
export const dynamic = "force-dynamic";

async function getDashboardStats() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await db.user.findUnique({
    where: { clerkId: userId },
    include: { sellerProfile: true },
  });

  if (!user?.sellerProfile) {
    return {
      totalListings: 0,
      activeListings: 0,
      pendingOrders: 0,
      completedOrders: 0,
      monthlyRevenue: 0,
      feeTier: "FREE" as const,
    };
  }

  const sellerId = user.sellerProfile.id;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Get listing counts
  const [totalListings, activeListings] = await Promise.all([
    db.eggListing.count({ where: { sellerId } }),
    db.eggListing.count({ where: { sellerId, isAvailable: true } }),
  ]);

  // Get order counts (pending = all current pending, completed = this month only)
  const startOfMonth = new Date(year, month - 1, 1);
  const [pendingOrders, completedOrders] = await Promise.all([
    db.order.count({
      where: {
        sellerId,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
    }),
    db.order.count({
      where: {
        sellerId,
        status: "COMPLETED",
        completedAt: { gte: startOfMonth },
      },
    }),
  ]);

  // Get monthly volume/revenue
  const volume = await db.sellerMonthlyVolume.findUnique({
    where: {
      sellerId_month_year: { sellerId, month, year },
    },
  });

  return {
    totalListings,
    activeListings,
    pendingOrders,
    completedOrders,
    monthlyRevenue: volume?.totalSales || 0,
    feeTier: volume?.feeTier || "FREE",
  };
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-900">Dashboard</h1>
          <p className="text-amber-600">Welcome back! Here&apos;s your overview.</p>
        </div>
        <Link href="/dashboard/listings/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Listing
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Listings</CardTitle>
            <Package className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-900">
              {stats.activeListings}
            </div>
            <p className="text-xs text-amber-600">
              {stats.totalListings} total listings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-900">
              {stats.pendingOrders}
            </div>
            <p className="text-xs text-amber-600">
              {stats.completedOrders} completed this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-900">
              ${stats.monthlyRevenue.toFixed(2)}
            </div>
            <p className="text-xs text-amber-600">Current fee tier: {stats.feeTier}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fee Tier</CardTitle>
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-900">{stats.feeTier}</div>
            <p className="text-xs text-amber-600">
              {stats.feeTier === "FREE"
                ? "0% platform fee"
                : stats.feeTier === "STARTER"
                ? "2% platform fee"
                : "3% platform fee"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link href="/dashboard/listings/new" className="block">
              <Button variant="outline" className="w-full justify-start">
                <Plus className="w-4 h-4 mr-2" />
                Create New Listing
              </Button>
            </Link>
            <Link href="/dashboard/orders" className="block">
              <Button variant="outline" className="w-full justify-start">
                <ShoppingCart className="w-4 h-4 mr-2" />
                View Orders
              </Button>
            </Link>
            <Link href="/dashboard/settings" className="block">
              <Button variant="outline" className="w-full justify-start">
                <Package className="w-4 h-4 mr-2" />
                Update Profile
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm font-medium">
                  1
                </div>
                <div>
                  <p className="font-medium text-amber-900">Complete your profile</p>
                  <p className="text-sm text-amber-600">
                    Add your location and pickup preferences
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm font-medium">
                  2
                </div>
                <div>
                  <p className="font-medium text-amber-900">Create your first listing</p>
                  <p className="text-sm text-amber-600">
                    Add photos, pricing, and availability
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm font-medium">
                  3
                </div>
                <div>
                  <p className="font-medium text-amber-900">Connect Stripe</p>
                  <p className="text-sm text-amber-600">
                    Set up payments to receive money
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
