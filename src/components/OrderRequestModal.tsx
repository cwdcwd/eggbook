"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ShoppingCart, MapPin, Calendar, Truck, Package } from "lucide-react";
import { Button, Input, Card, Badge } from "@/components/ui";
import { formatPrice, getUnitDisplay } from "@/lib/utils";

interface OrderRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: {
    id: string;
    title: string;
    pricePerUnit: number;
    unit: string;
    customUnitName: string | null;
    stockCount: number;
  };
  seller: {
    displayName: string;
    pickupType: string;
    maxDeliveryDistance: number | null;
  };
}

export function OrderRequestModal({
  isOpen,
  onClose,
  listing,
  seller,
}: OrderRequestModalProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [fulfillmentType, setFulfillmentType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [error, setError] = useState("");

  const totalPrice = listing.pricePerUnit * quantity;
  const canDeliver = seller.maxDeliveryDistance && seller.maxDeliveryDistance > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          quantity,
          fulfillmentType,
          pickupTime: pickupTime || null,
          deliveryAddress: fulfillmentType === "DELIVERY" ? deliveryAddress : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create order");
      }

      const order = await res.json();
      onClose();
      router.push(`/checkout/${order.id}`);
    } catch (error) {
      console.error("Failed to create order:", error);
      setError(error instanceof Error ? error.message : "Failed to create order");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-amber-100 p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-amber-900">Request Order</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-amber-100 flex items-center justify-center"
          >
            <X className="w-5 h-5 text-amber-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Listing Info */}
          <div className="bg-amber-50 rounded-lg p-4">
            <h3 className="font-semibold text-amber-900 mb-1">{listing.title}</h3>
            <p className="text-amber-600">
              {formatPrice(listing.pricePerUnit)} / {getUnitDisplay(listing.unit, listing.customUnitName)}
            </p>
            <p className="text-sm text-amber-500">
              from {seller.displayName} • {listing.stockCount} available
            </p>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-amber-900 mb-2">
              Quantity
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-10 h-10 rounded-lg border border-amber-200 flex items-center justify-center hover:bg-amber-50"
              >
                -
              </button>
              <Input
                type="number"
                min={1}
                max={listing.stockCount}
                value={quantity}
                onChange={(e) => setQuantity(Math.min(listing.stockCount, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-20 text-center"
              />
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(listing.stockCount, q + 1))}
                className="w-10 h-10 rounded-lg border border-amber-200 flex items-center justify-center hover:bg-amber-50"
              >
                +
              </button>
            </div>
          </div>

          {/* Fulfillment Type */}
          <div>
            <label className="block text-sm font-medium text-amber-900 mb-2">
              How would you like to receive your order?
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFulfillmentType("PICKUP")}
                className={`p-4 rounded-lg border-2 flex flex-col items-center gap-2 transition-colors ${
                  fulfillmentType === "PICKUP"
                    ? "border-amber-500 bg-amber-50"
                    : "border-amber-200 hover:border-amber-300"
                }`}
              >
                <Package className="w-6 h-6 text-amber-600" />
                <span className="text-sm font-medium text-amber-900">Pickup</span>
              </button>
              <button
                type="button"
                onClick={() => canDeliver && setFulfillmentType("DELIVERY")}
                disabled={!canDeliver}
                className={`p-4 rounded-lg border-2 flex flex-col items-center gap-2 transition-colors ${
                  fulfillmentType === "DELIVERY"
                    ? "border-amber-500 bg-amber-50"
                    : canDeliver
                    ? "border-amber-200 hover:border-amber-300"
                    : "border-gray-200 bg-gray-50 cursor-not-allowed"
                }`}
              >
                <Truck className={`w-6 h-6 ${canDeliver ? "text-amber-600" : "text-gray-400"}`} />
                <span className={`text-sm font-medium ${canDeliver ? "text-amber-900" : "text-gray-400"}`}>
                  Delivery
                </span>
                {!canDeliver && (
                  <span className="text-xs text-gray-400">Not available</span>
                )}
              </button>
            </div>
          </div>

          {/* Delivery Address */}
          {fulfillmentType === "DELIVERY" && (
            <div>
              <label className="block text-sm font-medium text-amber-900 mb-2">
                <MapPin className="w-4 h-4 inline mr-1" />
                Delivery Address
              </label>
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Enter your full address..."
                className="w-full h-24 px-3 py-2 rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                required
              />
              {seller.maxDeliveryDistance && (
                <p className="text-sm text-amber-500 mt-1">
                  Seller delivers within {seller.maxDeliveryDistance} miles
                </p>
              )}
            </div>
          )}

          {/* Pickup Time */}
          {fulfillmentType === "PICKUP" && (
            <div>
              <label className="block text-sm font-medium text-amber-900 mb-2">
                <Calendar className="w-4 h-4 inline mr-1" />
                Preferred Pickup Time (optional)
              </label>
              <Input
                type="datetime-local"
                value={pickupTime}
                onChange={(e) => setPickupTime(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
              />
              <p className="text-sm text-amber-500 mt-1">
                {seller.pickupType === "TIMESLOT"
                  ? "Seller has specific time slots"
                  : seller.pickupType === "HOURS"
                  ? "Seller has set available hours"
                  : "Seller will confirm pickup time after order"}
              </p>
            </div>
          )}

          {/* Total */}
          <div className="bg-amber-50 rounded-lg p-4">
            <div className="flex justify-between text-amber-700 mb-2">
              <span>Subtotal ({quantity} x {formatPrice(listing.pricePerUnit)})</span>
              <span>{formatPrice(totalPrice)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-amber-900">
              <span>Total</span>
              <span>{formatPrice(totalPrice)}</span>
            </div>
            <p className="text-xs text-amber-500 mt-2">
              Payment will be collected after seller confirms your order
            </p>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Submit */}
          <Button type="submit" className="w-full" isLoading={isLoading}>
            <ShoppingCart className="w-4 h-4 mr-2" />
            Request Order
          </Button>
        </form>
      </div>
    </div>
  );
}
