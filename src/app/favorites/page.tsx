import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Heart, MapPin, Trash2 } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui";
import { db } from "@/lib/db";

async function getFavorites(clerkId: string) {
  const user = await db.user.findUnique({
    where: { clerkId },
    include: {
      favorites: {
        include: {
          // Note: We need to join through SellerProfile to User
          // This is a simplified version
        },
      },
    },
  });

  if (!user) return [];

  // Get favorite seller profiles
  const favorites = await db.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  // Get seller profiles for each favorite
  const sellerProfiles = await db.sellerProfile.findMany({
    where: {
      id: { in: favorites.map((f) => f.sellerProfileId) },
    },
    include: {
      user: true,
      listings: {
        where: { isAvailable: true },
        take: 1,
      },
    },
  });

  return sellerProfiles;
}

export default async function FavoritesPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const favorites = await getFavorites(userId);

  return (
    <div className="min-h-screen bg-amber-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-amber-900 mb-6">
          <Heart className="w-6 h-6 inline mr-2 text-amber-500" />
          Favorite Sellers
        </h1>

        {favorites.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Heart className="w-8 h-8 text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold text-amber-900 mb-2">
              No favorites yet
            </h3>
            <p className="text-amber-600 mb-6 max-w-sm mx-auto">
              Start exploring and save your favorite egg sellers to quickly find them later.
            </p>
            <Link href="/explore">
              <Button>Explore Sellers</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {favorites.map((seller) => (
              <Card key={seller.id} className="overflow-hidden">
                <Link href={`/@${seller.user.username}`}>
                  <div className="flex gap-4 p-4">
                    <div className="w-16 h-16 rounded-full bg-amber-100 overflow-hidden flex-shrink-0">
                      {seller.avatarUrl ? (
                        <Image
                          src={seller.avatarUrl}
                          alt={seller.displayName}
                          width={64}
                          height={64}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">
                          🥚
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-amber-900 truncate">
                            {seller.displayName}
                          </h3>
                          <p className="text-sm text-amber-600">
                            @{seller.user.username}
                          </p>
                        </div>
                        <Badge variant={seller.isActive ? "success" : "warning"}>
                          {seller.isActive ? "Available" : "Unavailable"}
                        </Badge>
                      </div>
                      {seller.city && (
                        <div className="flex items-center gap-1 text-sm text-amber-500 mt-2">
                          <MapPin className="w-4 h-4" />
                          <span>
                            {seller.city}, {seller.state}
                          </span>
                        </div>
                      )}
                      {seller.listings.length > 0 && (
                        <p className="text-sm text-amber-600 mt-1">
                          {seller.listings.length} available listing{seller.listings.length !== 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="px-4 pb-4 flex gap-2">
                  <Link href={`/@${seller.user.username}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      View Profile
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
