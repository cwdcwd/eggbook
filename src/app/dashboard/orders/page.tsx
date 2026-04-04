"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Badge, Card, Button } from "@/components/ui";
import { formatPrice, formatDate, formatRelativeTime } from "@/lib/utils";
import { Check, X, MessageSquare, Eye, Loader2, History, ChevronDown } from "lucide-react";

const STATUS_BADGES: Record<string, { variant: "default" | "success" | "warning" | "error" | "info"; label: string }> = {
  PENDING: { variant: "warning", label: "Pending" },
  CONFIRMED: { variant: "info", label: "Confirmed" },
  PAID: { variant: "success", label: "Paid" },
  COMPLETED: { variant: "success", label: "Completed" },
  CANCELLED: { variant: "error", label: "Cancelled" },
  DECLINED: { variant: "error", label: "Declined" },
};

// Valid status transitions for sellers
const SELLER_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "DECLINED"],
  CONFIRMED: ["PAID", "COMPLETED", "CANCELLED"], // PAID for manual payment, COMPLETED for paid externally
  PAID: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  DECLINED: [],
};

type Order = {
  id: string;
  quantity: number;
  totalPrice: number;
  platformFee: number;
  status: string;
  fulfillmentType: string;
  pickupTime: string | null;
  deliveryAddress: string | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  listing: { title: string; pricePerUnit: number };
  buyer: { username: string; email: string };
};

type StatusHistoryEntry = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  changedByType: string;
  reason: string | null;
  createdAt: string;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>("All");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderHistory, setOrderHistory] = useState<StatusHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const statusParam = filter !== "All" ? `&status=${filter.toUpperCase()}` : "";
      const res = await fetch(`/api/orders?role=seller${statusParam}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Failed to fetch orders:", error);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  const fetchOrderHistory = useCallback(async (orderId: string) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/history`);
      if (res.ok) {
        const data = await res.json();
        setOrderHistory(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Failed to fetch order history:", error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [filter, fetchOrders]);

  useEffect(() => {
    if (selectedOrder) {
      fetchOrderHistory(selectedOrder.id);
    } else {
      setOrderHistory([]);
    }
  }, [selectedOrder, fetchOrderHistory]);

  const handleAction = async (orderId: string, action: string) => {
    setActionLoading(orderId);
    setStatusDropdownOpen(null);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Action failed");
      }

      // Refresh orders list
      fetchOrders();
      
      // Refresh history if modal is open
      if (selectedOrder?.id === orderId) {
        fetchOrderHistory(orderId);
      }
    } catch (error) {
      console.error("Action failed:", error);
      alert(error instanceof Error ? error.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const getActionForTransition = (from: string, to: string): string | null => {
    if (from === "PENDING" && to === "CONFIRMED") return "confirm";
    if (from === "PENDING" && to === "DECLINED") return "decline";
    if (to === "CANCELLED") return "cancel";
    if (from === "CONFIRMED" && to === "PAID") return "markPaid";
    if (to === "COMPLETED") return "complete";
    return null;
  };

  const handleStatusChange = (orderId: string, currentStatus: string, newStatus: string) => {
    const action = getActionForTransition(currentStatus, newStatus);
    if (action) {
      handleAction(orderId, action);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-amber-900">Orders</h1>
        <p className="text-amber-600">Manage incoming orders from buyers</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {["All", "Pending", "Confirmed", "Paid", "Completed", "Cancelled", "Declined"].map((f) => (
          <Button
            key={f}
            variant={filter === f ? "primary" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {orders.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Eye className="w-8 h-8 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-amber-900 mb-2">
            {filter === "All" ? "No orders yet" : `No ${filter.toLowerCase()} orders`}
          </h3>
          <p className="text-amber-600 max-w-sm mx-auto">
            When buyers request orders for your eggs, they&apos;ll appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const availableTransitions = SELLER_TRANSITIONS[order.status] || [];
            const hasTransitions = availableTransitions.length > 0;

            return (
            <Card key={order.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-amber-900">
                      Order #{order.id.slice(-6)}
                    </h3>
                    {/* Status dropdown for sellers */}
                    <div className="relative">
                      <button
                        onClick={() => hasTransitions && setStatusDropdownOpen(statusDropdownOpen === order.id ? null : order.id)}
                        className={`inline-flex items-center gap-1 ${hasTransitions ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                        disabled={actionLoading === order.id}
                      >
                        <Badge variant={STATUS_BADGES[order.status]?.variant || "default"}>
                          {STATUS_BADGES[order.status]?.label || order.status}
                          {hasTransitions && <ChevronDown className="w-3 h-3 ml-1 inline" />}
                        </Badge>
                      </button>
                      
                      {statusDropdownOpen === order.id && hasTransitions && (
                        <>
                          <div 
                            className="fixed inset-0 z-10" 
                            onClick={() => setStatusDropdownOpen(null)} 
                          />
                          <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-amber-200 py-1 z-20 min-w-[140px]">
                            {availableTransitions.map((status) => (
                              <button
                                key={status}
                                onClick={() => handleStatusChange(order.id, order.status, status)}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 flex items-center gap-2"
                              >
                                <Badge variant={STATUS_BADGES[status]?.variant || "default"} className="text-xs">
                                  {STATUS_BADGES[status]?.label || status}
                                </Badge>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-amber-600 mb-2">
                    {order.listing?.title} × {order.quantity} • from @{order.buyer?.username}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-amber-500">
                    <span>{formatDate(order.createdAt)}</span>
                    <span>{formatPrice(order.totalPrice)}</span>
                    <span className="capitalize">{order.fulfillmentType.toLowerCase()}</span>
                  </div>
                </div>

                {order.status === "PENDING" && (
                  <div className="flex gap-2">
                    <Link href={`/messages?order=${order.id}`}>
                      <Button size="sm" variant="outline">
                        <MessageSquare className="w-4 h-4 mr-1" />
                        Message
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleAction(order.id, "decline")}
                      disabled={actionLoading === order.id}
                    >
                      {actionLoading === order.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <X className="w-4 h-4 mr-1" />
                          Decline
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAction(order.id, "confirm")}
                      disabled={actionLoading === order.id}
                    >
                      {actionLoading === order.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-1" />
                          Confirm
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {order.status === "PAID" && (
                  <div className="flex gap-2">
                    <Link href={`/messages?order=${order.id}`}>
                      <Button size="sm" variant="outline">
                        <MessageSquare className="w-4 h-4 mr-1" />
                        Message
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      onClick={() => handleAction(order.id, "complete")}
                      disabled={actionLoading === order.id}
                    >
                      {actionLoading === order.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-1" />
                          Mark Complete
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {order.status === "CONFIRMED" && (
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-amber-600">Waiting for payment...</span>
                    <Link href={`/messages?order=${order.id}`}>
                      <Button size="sm" variant="outline">
                        <MessageSquare className="w-4 h-4 mr-1" />
                        Message
                      </Button>
                    </Link>
                  </div>
                )}

                {(order.status === "COMPLETED" || order.status === "CANCELLED" || order.status === "DECLINED") && (
                  <Button size="sm" variant="ghost" onClick={() => setSelectedOrder(order)}>
                    <Eye className="w-4 h-4 mr-1" />
                    View Details
                  </Button>
                )}

                {/* View history button for all statuses */}
                {!["COMPLETED", "CANCELLED", "DECLINED"].includes(order.status) && (
                  <Button size="sm" variant="ghost" onClick={() => setSelectedOrder(order)}>
                    <History className="w-4 h-4 mr-1" />
                    History
                  </Button>
                )}
              </div>
            </Card>
          )})}
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedOrder(null)}>
          <Card className="max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-amber-900">Order #{selectedOrder.id.slice(-6)}</h2>
                <Badge variant={STATUS_BADGES[selectedOrder.status]?.variant || "default"} className="mt-1">
                  {STATUS_BADGES[selectedOrder.status]?.label || selectedOrder.status}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(null)}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-amber-500 mb-1">Item</h3>
                <p className="text-amber-900">{selectedOrder.listing?.title}</p>
                <p className="text-sm text-amber-600">
                  {selectedOrder.quantity} × {formatPrice(selectedOrder.listing?.pricePerUnit || 0)}
                </p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-amber-500 mb-1">Buyer</h3>
                <p className="text-amber-900">@{selectedOrder.buyer?.username}</p>
                <p className="text-sm text-amber-600">{selectedOrder.buyer?.email}</p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-amber-500 mb-1">Fulfillment</h3>
                <p className="text-amber-900 capitalize">{selectedOrder.fulfillmentType.toLowerCase()}</p>
                {selectedOrder.deliveryAddress && (
                  <p className="text-sm text-amber-600">{selectedOrder.deliveryAddress}</p>
                )}
                {selectedOrder.pickupTime && (
                  <p className="text-sm text-amber-600">Pickup: {formatDate(selectedOrder.pickupTime)}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-amber-500 mb-1">Total</h3>
                  <p className="text-amber-900 font-semibold">{formatPrice(selectedOrder.totalPrice)}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-amber-500 mb-1">Platform Fee</h3>
                  <p className="text-amber-900">{formatPrice(selectedOrder.platformFee)}</p>
                </div>
              </div>

              {selectedOrder.cancelReason && (
                <div>
                  <h3 className="text-sm font-medium text-amber-500 mb-1">Reason</h3>
                  <p className="text-amber-600">{selectedOrder.cancelReason}</p>
                </div>
              )}

              {/* Order History Timeline */}
              <div className="border-t border-amber-100 pt-4 mt-4">
                <h3 className="text-sm font-medium text-amber-500 mb-3 flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Order History
                </h3>
                
                {historyLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                  </div>
                ) : orderHistory.length === 0 ? (
                  <p className="text-sm text-amber-400 text-center py-2">No history available</p>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-amber-200" />
                    
                    <div className="space-y-3">
                      {orderHistory.map((entry, index) => (
                        <div key={entry.id} className="relative flex gap-3 pl-6">
                          {/* Timeline dot */}
                          <div className={`absolute left-0 w-4 h-4 rounded-full border-2 ${
                            index === 0 
                              ? 'bg-amber-500 border-amber-500' 
                              : 'bg-white border-amber-300'
                          }`} />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {entry.fromStatus && (
                                <>
                                  <Badge variant={STATUS_BADGES[entry.fromStatus]?.variant || "default"} className="text-xs">
                                    {STATUS_BADGES[entry.fromStatus]?.label || entry.fromStatus}
                                  </Badge>
                                  <span className="text-amber-400">→</span>
                                </>
                              )}
                              <Badge variant={STATUS_BADGES[entry.toStatus]?.variant || "default"} className="text-xs">
                                {STATUS_BADGES[entry.toStatus]?.label || entry.toStatus}
                              </Badge>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-1 text-xs text-amber-500">
                              <span>{formatRelativeTime(entry.createdAt)}</span>
                              <span>•</span>
                              <span className="capitalize">
                                {entry.changedByType === "SYSTEM" ? "System" : entry.changedByType.toLowerCase()}
                              </span>
                            </div>
                            
                            {entry.reason && (
                              <p className="text-xs text-amber-600 mt-1 italic">{entry.reason}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="outline" onClick={() => setSelectedOrder(null)}>Close</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
