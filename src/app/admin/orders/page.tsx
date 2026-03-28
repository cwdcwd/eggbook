import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const dynamic = 'force-dynamic';
import { Card, Badge, Button } from "@/components/ui";
import { formatDate, formatPrice } from "@/lib/utils";
import { Eye, RefreshCw } from "lucide-react";

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { buyer: true; listing: true; seller: { include: { user: true } } };
}>;

async function getOrders(): Promise<OrderWithRelations[]> {
  return db.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      buyer: true,
      listing: true,
      seller: {
        include: { user: true },
      },
    },
  });
}

const STATUS_COLORS: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "info",
  PAID: "success",
  COMPLETED: "success",
  CANCELLED: "error",
  DECLINED: "error",
};

export default async function AdminOrdersPage() {
  const orders = await getOrders();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Order Management</h1>
        <p className="text-gray-500">{orders.length} total orders</p>
      </div>

      <Card className="bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Buyer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Seller
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Item
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="font-mono text-sm text-gray-900">
                      #{order.id.slice(-8)}
                    </p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-gray-900">@{order.buyer.username}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-gray-900">@{order.seller.user.username}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-900">{order.listing.title}</p>
                    <p className="text-sm text-gray-500">Qty: {order.quantity}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-gray-900">{formatPrice(order.totalPrice)}</p>
                    {order.platformFee > 0 && (
                      <p className="text-xs text-gray-500">
                        Fee: {formatPrice(order.platformFee)}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={STATUS_COLORS[order.status] || "default"}>
                      {order.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">
                    {formatDate(order.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm">
                        <Eye className="w-4 h-4" />
                      </Button>
                      {order.status === "PAID" && (
                        <Button variant="ghost" size="sm" title="Issue Refund">
                          <RefreshCw className="w-4 h-4 text-amber-500" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
