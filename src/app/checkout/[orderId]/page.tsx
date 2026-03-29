"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CreditCard, Loader2, Clock, MapPin, Package, Truck, AlertCircle } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { formatPrice, getUnitDisplay, formatDate } from "@/lib/utils";

interface Order {
  id: string;
  quantity: number;
  totalPrice: number;
  platformFee: number;
  status: string;
  fulfillmentType: string;
  pickupTime: string | null;
  deliveryAddress: string | null;
  createdAt: string;
  listing: {
    title: string;
    pricePerUnit: number;
    unit: string;
    customUnitName: string | null;
    photos: string[];
  };
  seller: {
    displayName: string;
    stripeAccountId: string | null;
    stripeOnboarded: boolean;
    user: { username: string };
  };
}

export default function CheckoutPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrder() {
      const { orderId } = await params;
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        if (!res.ok) {
          throw new Error("Order not found");
        }
        const data = await res.json();
        setOrder(data);
      } catch (err) {
        setError("Failed to load order");
      } finally {
        setIsLoading(false);
      }
    }
    fetchOrder();
  }, [params]);

  const handleCheckout = async () => {
    if (!order) return;

    setIsProcessing(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Checkout failed");
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-amber-900 mb-2">Order Not Found</h2>
          <p className="text-amber-600 mb-4">This order doesn't exist or you don't have access to it.</p>
          <Link href="/dashboard">
            <Button>Go to Dashboard</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const canPay = order.status === "CONFIRMED" && order.seller.stripeOnboarded;

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-amber-200">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link href="/dashboard" className="inline-flex items-center text-amber-600 hover:text-amber-800">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-amber-900 mb-6">Checkout</h1>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Order Details */}
          <div className="md:col-span-2 space-y-6">
            {/* Status Banner */}
            {order.status === "PENDING" && (
              <Card className="p-4 bg-amber-100 border-amber-300">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="font-medium text-amber-900">Waiting for seller confirmation</p>
                    <p className="text-sm text-amber-600">
                      The seller needs to confirm your order before you can pay.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {order.status === "CONFIRMED" && !order.seller.stripeOnboarded && (
              <Card className="p-4 bg-amber-100 border-amber-300">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="font-medium text-amber-900">Seller needs to set up payments</p>
                    <p className="text-sm text-amber-600">
                      The seller hasn't completed their payment setup yet. Please contact them.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {order.status === "PAID" && (
              <Card className="p-4 bg-green-100 border-green-300">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">Payment complete!</p>
                    <p className="text-sm text-green-600">
                      Your order has been paid. The seller will contact you about pickup/delivery.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Listing Info */}
            <Card className="overflow-hidden">
              <div className="flex gap-4 p-4">
                <div className="w-20 h-20 bg-amber-100 rounded-lg overflow-hidden flex-shrink-0">
                  {order.listing.photos?.[0] ? (
                    <Image
                      src={order.listing.photos[0]}
                      alt={order.listing.title}
                      width={80}
                      height={80}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">
                      🥚
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900">{order.listing.title}</h3>
                  <p className="text-amber-600 text-sm">
                    from @{order.seller.user.username}
                  </p>
                  <p className="text-amber-600 mt-1">
                    {order.quantity} × {formatPrice(order.listing.pricePerUnit)} / {getUnitDisplay(order.listing.unit, order.listing.customUnitName)}
                  </p>
                </div>
              </div>
            </Card>

            {/* Fulfillment Info */}
            <Card className="p-4">
              <h3 className="font-semibold text-amber-900 mb-3">Fulfillment</h3>
              <div className="flex items-start gap-3">
                {order.fulfillmentType === "PICKUP" ? (
                  <>
                    <Package className="w-5 h-5 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-900">Pickup</p>
                      {order.pickupTime && (
                        <p className="text-sm text-amber-600">
                          Requested: {formatDate(order.pickupTime)}
                        </p>
                      )}
                      <p className="text-sm text-amber-500">
                        Seller will confirm pickup details after payment.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Truck className="w-5 h-5 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-900">Delivery</p>
                      {order.deliveryAddress && (
                        <p className="text-sm text-amber-600">{order.deliveryAddress}</p>
                      )}
                      <p className="text-sm text-amber-500">
                        Seller will contact you to arrange delivery.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </Card>
          </div>

          {/* Order Summary */}
          <div>
            <Card className="p-4 sticky top-4">
              <h3 className="font-semibold text-amber-900 mb-4">Order Summary</h3>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-amber-600">Subtotal</span>
                  <span className="text-amber-900">{formatPrice(order.totalPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-600">Service Fee</span>
                  <span className="text-amber-900">{formatPrice(order.platformFee)}</span>
                </div>
                <div className="border-t border-amber-200 pt-2 mt-2">
                  <div className="flex justify-between font-semibold">
                    <span className="text-amber-900">Total</span>
                    <span className="text-amber-900">{formatPrice(order.totalPrice)}</span>
                  </div>
                  <p className="text-xs text-amber-500 mt-1">
                    (Service fee is included in total)
                  </p>
                </div>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">
                  {error}
                </div>
              )}

              <Button
                className="w-full mt-4"
                onClick={handleCheckout}
                disabled={!canPay || isProcessing}
                isLoading={isProcessing}
              >
                <CreditCard className="w-4 h-4 mr-2" />
                {canPay ? "Pay Now" : "Payment Not Available"}
              </Button>

              {order.status === "CONFIRMED" && (
                <p className="text-xs text-amber-500 text-center mt-2">
                  Secure payment powered by Stripe
                </p>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
