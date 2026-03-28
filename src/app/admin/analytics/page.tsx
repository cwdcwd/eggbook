import { db } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui";
import { Prisma } from "@prisma/client";

export const dynamic = 'force-dynamic';
import { formatPrice } from "@/lib/utils";

type SellerMonthlyVolume = Prisma.SellerMonthlyVolumeGetPayload<object>;
type OrderStat = { status: string; _count: number };
type StateStat = { state: string | null; _count: number };

type Analytics = {
  totalRevenue: number;
  platformFees: number;
  tierCounts: { FREE: number; STARTER: number; PRO: number };
  orderStats: OrderStat[];
  topStates: StateStat[];
  activeSellers: number;
};

async function getAnalytics(): Promise<Analytics> {
  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const thisYear = now.getFullYear();

  // Monthly volumes
  const monthlyVolumes = await db.sellerMonthlyVolume.findMany({
    where: {
      month: thisMonth,
      year: thisYear,
    },
  });

  const totalRevenue = monthlyVolumes.reduce((sum: number, v: SellerMonthlyVolume) => sum + v.totalSales, 0);

  // Fee tier distribution
  const tierCounts = {
    FREE: monthlyVolumes.filter((v: SellerMonthlyVolume) => v.feeTier === "FREE").length,
    STARTER: monthlyVolumes.filter((v: SellerMonthlyVolume) => v.feeTier === "STARTER").length,
    PRO: monthlyVolumes.filter((v: SellerMonthlyVolume) => v.feeTier === "PRO").length,
  };

  // Calculate platform fees
  const platformFees = monthlyVolumes.reduce((sum: number, v: SellerMonthlyVolume) => {
    if (v.feeTier === "STARTER") return sum + v.totalSales * 0.02;
    if (v.feeTier === "PRO") return sum + v.totalSales * 0.03;
    return sum;
  }, 0);

  // Order stats
  const orderStats = await db.order.groupBy({
    by: ["status"],
    _count: true,
  });

  // Geographic distribution (top states)
  const topStates = await db.sellerProfile.groupBy({
    by: ["state"],
    _count: true,
    where: {
      state: { not: null },
    },
    orderBy: {
      _count: {
        state: "desc",
      },
    },
    take: 10,
  });

  return {
    totalRevenue,
    platformFees,
    tierCounts,
    orderStats,
    topStates,
    activeSellers: monthlyVolumes.length,
  };
}

export default async function AdminAnalyticsPage() {
  const analytics = await getAnalytics();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>

      {/* Revenue Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-sm text-gray-500">
              Total Revenue (This Month)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">
              {formatPrice(analytics.totalRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-sm text-gray-500">
              Platform Fees (This Month)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">
              {formatPrice(analytics.platformFees)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-sm text-gray-500">
              Active Sellers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">
              {analytics.activeSellers}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Fee Tier Distribution */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Fee Tier Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-600">Free (0%)</span>
                <span className="text-sm font-medium text-gray-900">
                  {analytics.tierCounts.FREE} sellers
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{
                    width: `${
                      analytics.activeSellers > 0
                        ? (analytics.tierCounts.FREE / analytics.activeSellers) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-600">Starter (2%)</span>
                <span className="text-sm font-medium text-gray-900">
                  {analytics.tierCounts.STARTER} sellers
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-amber-500 h-2 rounded-full"
                  style={{
                    width: `${
                      analytics.activeSellers > 0
                        ? (analytics.tierCounts.STARTER / analytics.activeSellers) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-600">Pro (3%)</span>
                <span className="text-sm font-medium text-gray-900">
                  {analytics.tierCounts.PRO} sellers
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-purple-500 h-2 rounded-full"
                  style={{
                    width: `${
                      analytics.activeSellers > 0
                        ? (analytics.tierCounts.PRO / analytics.activeSellers) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Order Status Distribution */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Order Status Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {analytics.orderStats.map((stat) => (
              <div key={stat.status} className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">{stat._count}</p>
                <p className="text-sm text-gray-500">{stat.status}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top States */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Top Seller Locations</CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.topStates.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No location data yet</p>
          ) : (
            <div className="space-y-2">
              {analytics.topStates.map((state, index) => (
                <div
                  key={state.state}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </span>
                    <span className="text-gray-900">{state.state}</span>
                  </div>
                  <span className="text-gray-500">{state._count} sellers</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
