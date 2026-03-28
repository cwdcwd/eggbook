import Image from "next/image";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const dynamic = 'force-dynamic';
import { Card, Badge, Button } from "@/components/ui";
import { formatDate, formatPrice } from "@/lib/utils";
import { Eye, Trash2, Flag } from "lucide-react";

type ListingWithRelations = Prisma.EggListingGetPayload<{
  include: { seller: { include: { user: true } }; tags: true };
}>;

async function getListings(): Promise<ListingWithRelations[]> {
  return db.eggListing.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      seller: {
        include: { user: true },
      },
      tags: true,
    },
  });
}

export default async function AdminListingsPage() {
  const listings = await getListings();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Listing Moderation</h1>
        <p className="text-gray-500">{listings.length} total listings</p>
      </div>

      <Card className="bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Listing
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Seller
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {listings.map((listing) => (
                <tr key={listing.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-amber-100 rounded-lg overflow-hidden flex-shrink-0">
                        {listing.photos?.[0] ? (
                          <Image
                            src={listing.photos[0]}
                            alt={listing.title}
                            width={48}
                            height={48}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xl">
                            🥚
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{listing.title}</p>
                        <div className="flex gap-1 mt-1">
                          {listing.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag.id} variant="default" className="text-xs">
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-gray-900">{listing.seller.displayName}</p>
                    <p className="text-sm text-gray-500">
                      @{listing.seller.user.username}
                    </p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                    {formatPrice(listing.pricePerUnit)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={listing.isAvailable ? "success" : "warning"}>
                      {listing.isAvailable ? "Available" : "Unavailable"}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">
                    {formatDate(listing.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm">
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Flag className="w-4 h-4 text-yellow-500" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
