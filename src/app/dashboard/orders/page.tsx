import { Badge, Card, Button } from "@/components/ui";
import { formatPrice, formatDate } from "@/lib/utils";
import { Check, X, MessageSquare, Eye } from "lucide-react";

// Placeholder - will be replaced with actual data fetching
async function getOrders() {
  return [];
}

const STATUS_BADGES: Record<string, { variant: "default" | "success" | "warning" | "error" | "info"; label: string }> = {
  PENDING: { variant: "warning", label: "Pending" },
  CONFIRMED: { variant: "info", label: "Confirmed" },
  PAID: { variant: "success", label: "Paid" },
  COMPLETED: { variant: "success", label: "Completed" },
  CANCELLED: { variant: "error", label: "Cancelled" },
  DECLINED: { variant: "error", label: "Declined" },
};

export default async function OrdersPage() {
  const orders = await getOrders();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-amber-900">Orders</h1>
        <p className="text-amber-600">Manage incoming orders from buyers</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {["All", "Pending", "Confirmed", "Completed"].map((filter) => (
          <Button
            key={filter}
            variant={filter === "All" ? "primary" : "outline"}
            size="sm"
          >
            {filter}
          </Button>
        ))}
      </div>

      {orders.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Eye className="w-8 h-8 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-amber-900 mb-2">
            No orders yet
          </h3>
          <p className="text-amber-600 max-w-sm mx-auto">
            When buyers request orders for your eggs, they&apos;ll appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order: any) => (
            <Card key={order.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-amber-900">
                      Order #{order.id.slice(-6)}
                    </h3>
                    <Badge variant={STATUS_BADGES[order.status]?.variant || "default"}>
                      {STATUS_BADGES[order.status]?.label || order.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-amber-600 mb-2">
                    {order.listing?.title} × {order.quantity}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-amber-500">
                    <span>{formatDate(order.createdAt)}</span>
                    <span>{formatPrice(order.totalPrice)}</span>
                    <span className="capitalize">{order.fulfillmentType.toLowerCase()}</span>
                  </div>
                </div>

                {order.status === "PENDING" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">
                      <MessageSquare className="w-4 h-4 mr-1" />
                      Message
                    </Button>
                    <Button size="sm" variant="danger">
                      <X className="w-4 h-4 mr-1" />
                      Decline
                    </Button>
                    <Button size="sm">
                      <Check className="w-4 h-4 mr-1" />
                      Confirm
                    </Button>
                  </div>
                )}

                {order.status === "PAID" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">
                      <MessageSquare className="w-4 h-4 mr-1" />
                      Message
                    </Button>
                    <Button size="sm">
                      <Check className="w-4 h-4 mr-1" />
                      Mark Complete
                    </Button>
                  </div>
                )}

                {(order.status === "COMPLETED" || order.status === "CANCELLED" || order.status === "DECLINED") && (
                  <Button size="sm" variant="ghost">
                    <Eye className="w-4 h-4 mr-1" />
                    View Details
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
