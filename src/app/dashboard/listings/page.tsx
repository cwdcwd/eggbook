import Link from "next/link";
import Image from "next/image";
import { Plus, Edit, Trash2, MoreVertical, Crown } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { formatPrice, getUnitDisplay } from "@/lib/utils";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { DeleteListingButton } from "@/components/DeleteListingButton";

async function getListings() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await db.user.findUnique({
    where: { clerkId: userId },
    include: { sellerProfile: true },
  });

  if (!user?.sellerProfile) {
    return [];
  }

  const listings = await db.eggListing.findMany({
    where: { sellerId: user.sellerProfile.id },
    include: {
      tags: true,
      _count: { select: { orders: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return listings;
}

export default async function ListingsPage() {
  const { has } = await auth();
  const hasSellerSubscription = has({ feature: "create-listings" });
  const listings = await getListings();

  return (
    <div className="space-y-6">
      {/* Subscription Banner for non-subscribers */}
      {!hasSellerSubscription && (
        <Card className="p-6 bg-gradient-to-r from-amber-100 to-amber-50 border-amber-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-amber-900">
                  Subscribe to Create Listings
                </h3>
                <p className="text-amber-700 text-sm">
                  Get a seller subscription to create unlimited egg listings and start selling.
                </p>
              </div>
            </div>
            <Link href="/pricing">
              <Button>
                <Crown className="w-4 h-4 mr-2" />
                View Plans
              </Button>
            </Link>
          </div>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-900">My Listings</h1>
          <p className="text-amber-600">Manage your egg listings</p>
        </div>
        {hasSellerSubscription && (
          <Link href="/dashboard/listings/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Listing
            </Button>
          </Link>
        )}
      </div>

      {listings.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Plus className="w-8 h-8 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-amber-900 mb-2">
            No listings yet
          </h3>
          <p className="text-amber-600 mb-6 max-w-sm mx-auto">
            {hasSellerSubscription 
              ? "Create your first egg listing to start selling to customers in your area."
              : "Subscribe to a seller plan to create listings and start selling."}
          </p>
          {hasSellerSubscription ? (
            <Link href="/dashboard/listings/new">
              <Button>Create Your First Listing</Button>
            </Link>
          ) : (
            <Link href="/pricing">
              <Button>
                <Crown className="w-4 h-4 mr-2" />
                View Plans
              </Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing: any) => (
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
                  <div className="absolute inset-0 flex items-center justify-center text-amber-400">
                    No photo
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <Badge variant={listing.isAvailable ? "success" : "warning"}>
                    {listing.isAvailable ? "Available" : "Unavailable"}
                  </Badge>
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-amber-900 mb-1">
                  {listing.title}
                </h3>
                <p className="text-amber-600 text-sm mb-2">
                  {formatPrice(listing.pricePerUnit)} per{" "}
                  {getUnitDisplay(listing.unit, listing.customUnitName)}
                </p>
                <p className="text-amber-500 text-sm mb-4">
                  Stock: {listing.stockCount}
                </p>
                <div className="flex gap-2">
                  <Link href={`/dashboard/listings/${listing.id}/edit`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  </Link>
                  <DeleteListingButton listingId={listing.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
