import Link from "next/link";
import Image from "next/image";
import { MapPin, Search, Filter, Star, Heart, MessageSquare } from "lucide-react";
import { Button, Card, Badge, Input } from "@/components/ui";
import { formatPrice } from "@/lib/utils";
import { db } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";

// Fetch active sellers with their listings
async function getSellers(searchParams: { q?: string; lat?: string; lng?: string; tag?: string; delivery?: string }) {
  const sellers = await db.sellerProfile.findMany({
    where: {
      isActive: true,
      listings: {
        some: { 
          isAvailable: true,
          ...(searchParams.tag && {
            tags: {
              some: { slug: searchParams.tag },
            },
          }),
        },
      },
      ...(searchParams.q && {
        OR: [
          { displayName: { contains: searchParams.q, mode: "insensitive" } },
          { city: { contains: searchParams.q, mode: "insensitive" } },
          { state: { contains: searchParams.q, mode: "insensitive" } },
        ],
      }),
      ...(searchParams.delivery === "true" && {
        maxDeliveryDistance: { gt: 0 },
      }),
    },
    include: {
      user: {
        select: { username: true },
      },
      listings: {
        where: { isAvailable: true },
        include: { tags: true },
        take: 5,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return sellers;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lat?: string; lng?: string; tag?: string; delivery?: string }>;
}) {
  const params = await searchParams;
  const sellers = await getSellers(params);
  const { userId } = await auth();
  const isLoggedIn = !!userId;

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-amber-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center">
                <span className="text-white text-xl">🥚</span>
              </div>
              <span className="text-xl font-bold text-amber-900">Eggbook</span>
            </Link>
            <div className="flex items-center gap-4">
              {isLoggedIn ? (
                <>
                  <Link href="/favorites" className="text-amber-600 hover:text-amber-700">
                    <Heart className="w-6 h-6" />
                  </Link>
                  <Link href="/messages" className="text-amber-600 hover:text-amber-700">
                    <MessageSquare className="w-6 h-6" />
                  </Link>
                  <Link href="/dashboard">
                    <Button variant="outline" size="sm">Dashboard</Button>
                  </Link>
                </>
              ) : (
                <Link href="/sign-in">
                  <Button variant="outline" size="sm">Sign In</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar */}
        <div className="mb-8">
          <form action="/explore" method="get" className="flex gap-2 bg-white rounded-full p-2 shadow-lg border border-amber-200 max-w-2xl mx-auto">
            <div className="flex-1 flex items-center gap-2 px-4">
              <MapPin className="w-5 h-5 text-amber-500" />
              <input
                type="text"
                name="q"
                placeholder="Search by location, seller name..."
                defaultValue={params.q}
                className="flex-1 outline-none text-gray-700"
              />
            </div>
            <Button type="submit" className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              <span className="hidden sm:inline">Search</span>
            </Button>
          </form>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap mb-6">
          <Button variant="outline" size="sm">
            <Filter className="w-4 h-4 mr-1" />
            Filters
          </Button>
          <Link href="/explore?tag=chicken">
            <Button variant="outline" size="sm">Chicken</Button>
          </Link>
          <Link href="/explore?tag=duck">
            <Button variant="outline" size="sm">Duck</Button>
          </Link>
          <Link href="/explore?tag=organic">
            <Button variant="outline" size="sm">Organic</Button>
          </Link>
          <Link href="/explore?tag=free-range">
            <Button variant="outline" size="sm">Free-Range</Button>
          </Link>
          <Link href="/explore?delivery=true">
            <Button variant="outline" size="sm">Delivery Available</Button>
          </Link>
        </div>

        {/* Results */}
        {sellers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MapPin className="w-10 h-10 text-amber-400" />
            </div>
            <h2 className="text-xl font-semibold text-amber-900 mb-2">
              No sellers found nearby
            </h2>
            <p className="text-amber-600 mb-6 max-w-md mx-auto">
              Try searching for a different location or expanding your search area.
            </p>
            <Button variant="outline">Use My Location</Button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sellers.map((seller: any) => (
              <Link href={`/@${seller.user.username}`} key={seller.id}>
                <Card className="overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="aspect-video relative bg-amber-100">
                    {seller.avatarUrl ? (
                      <Image
                        src={seller.avatarUrl}
                        alt={seller.displayName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-6xl">
                        🥚
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <Badge variant={seller.isActive ? "success" : "warning"}>
                        {seller.isActive ? "Available" : "Unavailable"}
                      </Badge>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-amber-900">
                          {seller.displayName}
                        </h3>
                        <p className="text-sm text-amber-600">
                          @{seller.user.username}
                        </p>
                      </div>
                      <button className="text-amber-400 hover:text-amber-500">
                        <Heart className="w-5 h-5" />
                      </button>
                    </div>
                    <p className="text-sm text-amber-500 mb-2 line-clamp-2">
                      {seller.bio || "Fresh eggs from our farm"}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-amber-600">
                      <MapPin className="w-4 h-4" />
                      <span>
                        {seller.city}, {seller.state}
                      </span>
                    </div>
                    {seller.listings && seller.listings.length > 0 && (
                      <p className="text-sm text-amber-500 mt-2">
                        Starting at {formatPrice(Math.min(...seller.listings.map((l: any) => l.pricePerUnit)))} / dozen
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
