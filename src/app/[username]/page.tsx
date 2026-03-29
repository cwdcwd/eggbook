import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Heart, MessageSquare, ShoppingCart, Share2, Search } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { formatPrice, getUnitDisplay } from "@/lib/utils";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/ListingCard";
import { SellerActionButtons } from "@/components/SellerActionButtons";
import { auth } from "@clerk/nextjs/server";
import type { User, SellerProfile, EggListing, Tag, Post } from "@/lib/prisma-types";
export const dynamic = 'force-dynamic';

type ListingWithTags = EggListing & { tags: Tag[] };
type SellerProfileWithRelations = SellerProfile & { listings: ListingWithTags[]; posts: Post[] };
type UserWithProfile = User & { sellerProfile: SellerProfileWithRelations };

async function getSellerByUsername(username: string): Promise<UserWithProfile | null> {
  console.log("Querying for username:", username);
  
  // Debug: Log all users
  const allUsers = await db.user.findMany({ 
    select: { username: true, role: true },
  });
  console.log("All users in DB:", allUsers);
  
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
  const { userId } = await auth();
  
  // Remove @ if present and decode URL encoding
  const username = decodeURIComponent(rawUsername).replace(/^@/, "");
  console.log("Profile page - rawUsername:", rawUsername, "parsed username:", username);
  const seller = await getSellerByUsername(username);
  console.log("Profile page - seller found:", !!seller, "has profile:", !!seller?.sellerProfile);

  if (!seller || !seller.sellerProfile) {
    notFound();
  }

  const profile = seller.sellerProfile;
  const isLoggedIn = !!userId;

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-amber-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center">
              <Image src="/logo.png" alt="Addie's Egg Book" width={48} height={48} className="w-12 h-12" />
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/explore" className="text-amber-600 hover:text-amber-700">
                <Search className="w-6 h-6" />
              </Link>
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
                <SellerActionButtons
                  sellerProfileId={profile.id}
                  sellerUserId={seller.id}
                  sellerUsername={seller.username}
                />
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
              {profile.listings.map((listing: ListingWithTags) => (
                <ListingCard
                  key={listing.id}
                  listing={{
                    id: listing.id,
                    title: listing.title,
                    description: listing.description,
                    pricePerUnit: listing.pricePerUnit,
                    unit: listing.unit,
                    customUnitName: listing.customUnitName,
                    stockCount: listing.stockCount,
                    photos: listing.photos,
                    tags: listing.tags.map((t: Tag) => ({ id: t.id, name: t.name })),
                  }}
                  seller={{
                    displayName: profile.displayName,
                    pickupType: profile.pickupType,
                    maxDeliveryDistance: profile.maxDeliveryDistance,
                  }}
                />
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
              {profile.posts.map((post: Post) => (
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
