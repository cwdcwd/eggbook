"use client";

import { useState } from "react";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { formatPrice, getUnitDisplay } from "@/lib/utils";
import { OrderRequestModal } from "@/components/OrderRequestModal";

interface ListingCardProps {
  listing: {
    id: string;
    title: string;
    description: string | null;
    pricePerUnit: number;
    unit: string;
    customUnitName: string | null;
    stockCount: number;
    photos: string[];
    tags: { id: string; name: string }[];
  };
  seller: {
    displayName: string;
    pickupType: string;
    maxDeliveryDistance: number | null;
  };
}

export function ListingCard({ listing, seller }: ListingCardProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <Card className="overflow-hidden">
        <div className="aspect-video relative bg-amber-100">
          {listing.photos?.[0] ? (
            <Image
              src={listing.photos[0]}
              alt={listing.title}
              fill
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-4xl">
              🥚
            </div>
          )}
        </div>
        <div className="p-4">
          <h3 className="font-semibold text-amber-900 mb-1">
            {listing.title}
          </h3>
          <p className="text-lg font-bold text-amber-600 mb-2">
            {formatPrice(listing.pricePerUnit)} /{" "}
            {getUnitDisplay(listing.unit, listing.customUnitName)}
          </p>
          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {listing.tags.map((tag) => (
                <Badge key={tag.id} variant="default">
                  {tag.name}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-sm text-amber-500 mb-4">
            {listing.stockCount} in stock
          </p>
          <Button className="w-full" onClick={() => setShowModal(true)}>
            <ShoppingCart className="w-4 h-4 mr-2" />
            Request Order
          </Button>
        </div>
      </Card>

      <OrderRequestModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        listing={listing}
        seller={seller}
      />
    </>
  );
}
