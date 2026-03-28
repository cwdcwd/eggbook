import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Heart, MessageSquare, ShoppingCart, Share2 } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { formatPrice, getUnitDisplay } from "@/lib/utils";
import { db } from "@/lib/db";
import type { EggListing, Tag, Post, SellerProfile, User } from "@prisma/client";

type ListingWithTags = EggListing & { tags: Tag[] };
type SellerProfileWithRelations = SellerProfile & { listings: ListingWithTags[]; posts: Post[] };
type UserWithProfile = User & { sellerProfile: SellerProfileWithRelations | null };

async function getSellerByUsername(username: string): Promise<UserWithProfile | null> {
  const user = await db.user.findUnique({
    where: { username },
    include: {
      sellerProfile: {
        include: {
          listings: {
            where: { isAvailable: true },
            include: { tags: true },
          },
          posts: {
            take: 10,
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!user?.sellerProfile) return null;
  return user as UserWithProfile;
}

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username: rawUsername } = await params;
  // Remove @ if present
  const username = rawUsername.replace("@", "");
  const seller = await getSellerByUsername(username);

  if (!seller || !seller.sellerProfile) {
    notFound();
  }

  const profile = seller.sellerProfile;

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
              <Link href="/sign-in">
                <Button variant="outline" size="sm">Sign In</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Profile Header */}
        <Card className="p-6 mb-8">
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Avatar */}
            <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-amber-100 overflow-hidden flex-shrink-0 mx-auto sm:mx-0">
              {profile.avatarUrl ? (
                <Image
                  src={profile.avatarUrl}
                  alt={profile.displayName}
                  width={128}
                  height={128}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-5xl">
                  🥚
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                <h1 className="text-2xl font-bold text-amber-900">
                  {profile.displayName}
                </h1>
                <Badge variant={profile.isActive ? "success" : "warning"}>
                  {profile.isActive ? "Available" : "Not Available"}
                </Badge>
              </div>
              <p className="text-amber-600 mb-2">@{seller.username}</p>
              {profile.bio && (
                <p className="text-amber-700 mb-4">{profile.bio}</p>
              )}

              <div className="flex flex-wrap justify-center sm:justify-start gap-4 text-sm text-amber-600 mb-4">
                {profile.city && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    <span>
                      {profile.city}, {profile.state}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  <span>
                    {profile.pickupType === "TIMESLOT"
                      ? "Time slots available"
                      : profile.pickupType === "HOURS"
                      ? "Available hours"
                      : "Arrange after order"}
                  </span>
                </div>
                {profile.maxDeliveryDistance && (
                  <div className="flex items-center gap-1">
                    <span>Delivers within {profile.maxDeliveryDistance} miles</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                <Button>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Message
                </Button>
                <Button variant="outline">
                  <Heart className="w-4 h-4 mr-2" />
                  Favorite
                </Button>
                <Button variant="ghost">
                  <Share2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Listings */}
        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-4">
            Available Eggs ({profile.listings.length})
          </h2>

          {profile.listings.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-amber-600">
                No listings available at the moment.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {profile.listings.map((listing) => (
                <Card key={listing.id} className="overflow-hidden">
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
                    <Button className="w-full">
                      <ShoppingCart className="w-4 h-4 mr-2" />
                      Request Order
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Posts */}
        {profile.posts.length > 0 && (
          <section>
            <h2 className="text-xl font-bold text-amber-900 mb-4">
              Recent Posts
            </h2>
            <div className="space-y-4">
              {profile.posts.map((post) => (
                <Card key={post.id} className="p-4">
                  <p className="text-amber-700 whitespace-pre-wrap">
                    {post.content}
                  </p>
                  {post.imageUrl && (
                    <div className="mt-4 rounded-lg overflow-hidden">
                      <Image
                        src={post.imageUrl}
                        alt="Post image"
                        width={500}
                        height={300}
                        className="w-full object-cover"
                      />
                    </div>
                  )}
                  <p className="text-sm text-amber-500 mt-2">
                    {new Date(post.createdAt).toLocaleDateString()}
                  </p>
                </Card>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
