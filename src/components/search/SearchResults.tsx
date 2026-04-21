"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Heart, Star, Truck } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { formatPrice, cn } from "@/lib/utils";

interface Listing {
  id: string;
  title: string;
  pricePerUnit: number;
  photos: string[];
  tags: Array<{ name: string; slug: string }>;
}

interface Seller {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  city: string;
  state: string;
  bio: string | null;
  maxDeliveryDistance: number | null;
  user: { username: string };
  listings: Listing[];
  distance?: number;
  _count?: { orders: number };
}

interface SearchResultsProps {
  sellers: Seller[];
  isLoading: boolean;
  view: "grid" | "list";
  onFavorite?: (sellerId: string) => void;
  favorites?: string[];
}

function SellerCard({ seller, onFavorite, isFavorite }: { seller: Seller; onFavorite?: (id: string) => void; isFavorite: boolean }) {
  const minPrice = seller.listings.length > 0
    ? Math.min(...seller.listings.map((l) => l.pricePerUnit))
    : null;
  const allTags = [...new Set(seller.listings.flatMap((l) => l.tags.map((t) => t.name)))].slice(0, 3);
  const coverPhoto = seller.listings?.[0]?.photos?.[0] || seller.avatarUrl;

  return (
    <Link href={`/@${seller.user.username}`}>
      <Card className="overflow-hidden hover:shadow-lg transition-all hover:-translate-y-1 group h-full">
        <div className="aspect-[4/3] relative bg-amber-100">
          {coverPhoto ? (
            <Image
              src={coverPhoto}
              alt={seller.displayName}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-6xl">
              🥚
            </div>
          )}
          
          {/* Overlay badges */}
          <div className="absolute top-2 left-2 flex gap-1">
            {seller.maxDeliveryDistance && seller.maxDeliveryDistance > 0 && (
              <Badge variant="secondary" className="bg-white/90">
                <Truck className="w-3 h-3 mr-1" />
                Delivers
              </Badge>
            )}
          </div>

          {/* Favorite button */}
          {onFavorite && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFavorite(seller.id);
              }}
              className={cn(
                "absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                isFavorite 
                  ? "bg-red-500 text-white" 
                  : "bg-white/90 text-amber-400 hover:text-red-500"
              )}
            >
              <Heart className={cn("w-4 h-4", isFavorite && "fill-current")} />
            </button>
          )}

          {/* Distance badge */}
          {seller.distance !== undefined && (
            <div className="absolute bottom-2 right-2">
              <Badge variant="secondary" className="bg-white/90 font-medium">
                {seller.distance < 1 
                  ? "< 1 mi" 
                  : `${seller.distance.toFixed(1)} mi`}
              </Badge>
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-amber-900 truncate">
                {seller.displayName}
              </h3>
              <p className="text-sm text-amber-500 truncate">
                @{seller.user.username}
              </p>
            </div>
            {minPrice && (
              <div className="text-right ml-2">
                <p className="text-lg font-bold text-amber-600">
                  {formatPrice(minPrice)}
                </p>
                <p className="text-xs text-amber-400">/dozen</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 text-sm text-amber-600 mb-2">
            <MapPin className="w-3 h-3" />
            <span className="truncate">{seller.city}, {seller.state}</span>
          </div>

          {seller.bio && (
            <p className="text-sm text-amber-500 line-clamp-2 mb-2">
              {seller.bio}
            </p>
          )}

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs px-2 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function SellerListItem({ seller, onFavorite, isFavorite }: { seller: Seller; onFavorite?: (id: string) => void; isFavorite: boolean }) {
  const minPrice = seller.listings.length > 0
    ? Math.min(...seller.listings.map((l) => l.pricePerUnit))
    : null;
  const allTags = [...new Set(seller.listings.flatMap((l) => l.tags.map((t) => t.name)))].slice(0, 4);
  const coverPhoto = seller.listings?.[0]?.photos?.[0] || seller.avatarUrl;

  return (
    <Link href={`/@${seller.user.username}`}>
      <Card className="overflow-hidden hover:shadow-md transition-shadow">
        <div className="flex gap-4 p-4">
          {/* Image */}
          <div className="w-32 h-24 relative rounded-lg overflow-hidden bg-amber-100 flex-shrink-0">
            {coverPhoto ? (
              <Image
                src={coverPhoto}
                alt={seller.displayName}
                fill
                className="object-cover"
                sizes="128px"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-3xl">
                🥚
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <h3 className="font-semibold text-amber-900 truncate">
                  {seller.displayName}
                </h3>
                <div className="flex items-center gap-2 text-sm text-amber-500">
                  <span>@{seller.user.username}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {seller.city}, {seller.state}
                  </span>
                  {seller.distance !== undefined && (
                    <>
                      <span>•</span>
                      <span>{seller.distance.toFixed(1)} mi</span>
                    </>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2 ml-2">
                {minPrice && (
                  <div className="text-right">
                    <p className="text-lg font-bold text-amber-600">
                      {formatPrice(minPrice)}
                    </p>
                    <p className="text-xs text-amber-400">/dozen</p>
                  </div>
                )}
                {onFavorite && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onFavorite(seller.id);
                    }}
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                      isFavorite 
                        ? "bg-red-100 text-red-500" 
                        : "bg-amber-100 text-amber-400 hover:text-red-500"
                    )}
                  >
                    <Heart className={cn("w-4 h-4", isFavorite && "fill-current")} />
                  </button>
                )}
              </div>
            </div>

            {seller.bio && (
              <p className="text-sm text-amber-600 line-clamp-1 mt-1">
                {seller.bio}
              </p>
            )}

            <div className="flex items-center gap-2 mt-2">
              {allTags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs px-2 py-0">
                  {tag}
                </Badge>
              ))}
              {seller.maxDeliveryDistance && seller.maxDeliveryDistance > 0 && (
                <Badge variant="secondary" className="text-xs px-2 py-0">
                  <Truck className="w-3 h-3 mr-1" />
                  Delivers
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function SearchResults({ sellers, isLoading, view, onFavorite, favorites = [] }: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className={cn(
        "gap-6",
        view === "grid" ? "grid md:grid-cols-2 lg:grid-cols-3" : "flex flex-col"
      )}>
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="overflow-hidden animate-pulse">
            {view === "grid" ? (
              <>
                <div className="aspect-[4/3] bg-amber-200" />
                <div className="p-4 space-y-2">
                  <div className="h-5 bg-amber-200 rounded w-3/4" />
                  <div className="h-4 bg-amber-100 rounded w-1/2" />
                  <div className="h-4 bg-amber-100 rounded w-2/3" />
                </div>
              </>
            ) : (
              <div className="flex gap-4 p-4">
                <div className="w-32 h-24 bg-amber-200 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-amber-200 rounded w-1/2" />
                  <div className="h-4 bg-amber-100 rounded w-3/4" />
                  <div className="h-4 bg-amber-100 rounded w-1/4" />
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  }

  if (sellers.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <MapPin className="w-10 h-10 text-amber-400" />
        </div>
        <h2 className="text-xl font-semibold text-amber-900 mb-2">
          No sellers found
        </h2>
        <p className="text-amber-600 mb-6 max-w-md mx-auto">
          Try adjusting your filters or searching in a different area.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(
      "gap-6",
      view === "grid" ? "grid md:grid-cols-2 lg:grid-cols-3" : "flex flex-col"
    )}>
      {sellers.map((seller) => (
        view === "grid" ? (
          <SellerCard
            key={seller.id}
            seller={seller}
            onFavorite={onFavorite}
            isFavorite={favorites.includes(seller.id)}
          />
        ) : (
          <SellerListItem
            key={seller.id}
            seller={seller}
            onFavorite={onFavorite}
            isFavorite={favorites.includes(seller.id)}
          />
        )
      ))}
    </div>
  );
}
