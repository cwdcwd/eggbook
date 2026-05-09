"use client";

import { useEffect, useState, useCallback } from "react";
import { Package, ShoppingCart, DollarSign, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { usePusherRefresh } from "@/hooks/usePusherRefresh";

interface DashboardStats {
  totalListings: number;
  activeListings: number;
  pendingOrders: number;
  completedOrders: number;
  monthlyRevenue: number;
  feeTier: string;
}

export function DashboardStats({ initial }: { initial: DashboardStats }) {
  const [stats, setStats] = useState<DashboardStats>(initial);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // Non-critical — keep showing stale data
    }
  }, []);

  // Real-time: refresh stats when new orders or order updates arrive
  usePusherRefresh(["new-order", "order-update"], refreshStats);

  return (
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
  );
}
