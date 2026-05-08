import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// Maximum number of results per request
const MAX_LIMIT = 100;

// Calculate distance between two points using Haversine formula (returns miles)
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function GET(req: NextRequest) {
  try {
    // Rate limit by IP (public endpoint)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
    const rl = await rateLimit(ip, "search");
    if (!rl.success) return rl.response;

    const { searchParams } = new URL(req.url);
    
    // Extract query parameters with validation
    const q = (searchParams.get("q") || "").slice(0, 200);
    const rawLat = searchParams.get("lat") ? Number(searchParams.get("lat")) : null;
    const rawLng = searchParams.get("lng") ? Number(searchParams.get("lng")) : null;
    const lat = rawLat !== null && Number.isFinite(rawLat) && rawLat >= -90 && rawLat <= 90 ? rawLat : null;
    const lng = rawLng !== null && Number.isFinite(rawLng) && rawLng >= -180 && rawLng <= 180 ? rawLng : null;
    const tags = searchParams.get("tags")?.split(",").filter(Boolean).slice(0, 20) || [];
    const rawMinPrice = searchParams.get("minPrice") ? Number(searchParams.get("minPrice")) : null;
    const rawMaxPrice = searchParams.get("maxPrice") ? Number(searchParams.get("maxPrice")) : null;
    const minPrice = rawMinPrice !== null && Number.isFinite(rawMinPrice) && rawMinPrice >= 0 ? rawMinPrice : null;
    const maxPrice = rawMaxPrice !== null && Number.isFinite(rawMaxPrice) && rawMaxPrice >= 0 ? rawMaxPrice : null;
    const delivery = searchParams.get("delivery") === "true";
    const sort = searchParams.get("sort") || "relevance";
    const rawLimit = Number(searchParams.get("limit") || "50");
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : 50;

    // Build the where clause for sellers
    const sellerWhere: any = {
      isActive: true,
      listings: {
        some: {
          isAvailable: true,
          hiddenBySubscription: false,
        },
      },
    };

    // Full-text search across multiple fields
    if (q) {
      sellerWhere.OR = [
        // Search seller fields
        { displayName: { contains: q, mode: "insensitive" } },
        { bio: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { state: { contains: q, mode: "insensitive" } },
        { zip: { startsWith: q } },
        // Search listing fields
        {
          listings: {
            some: {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { tags: { some: { name: { contains: q, mode: "insensitive" } } } },
              ],
              isAvailable: true,
              hiddenBySubscription: false,
            },
          },
        },
      ];
    }

    // Tag filter (supports multiple tags with OR logic)
    if (tags.length > 0) {
      sellerWhere.listings = {
        some: {
          isAvailable: true,
          hiddenBySubscription: false,
          tags: {
            some: { slug: { in: tags } },
          },
        },
      };
    }

    // Delivery filter
    if (delivery) {
      sellerWhere.maxDeliveryDistance = { gt: 0 };
    }

    // Price filter - applied to listings
    if (minPrice !== null || maxPrice !== null) {
      sellerWhere.listings = {
        some: {
          isAvailable: true,
          hiddenBySubscription: false,
          ...(minPrice !== null && { pricePerUnit: { gte: minPrice } }),
          ...(maxPrice !== null && { pricePerUnit: { lte: maxPrice } }),
          ...(tags.length > 0 && { tags: { some: { slug: { in: tags } } } }),
        },
      };
    }

    // Fetch sellers with their listings
    const sellers = await db.sellerProfile.findMany({
      where: sellerWhere,
      include: {
        user: {
          select: { username: true },
        },
        listings: {
          where: {
            isAvailable: true,
            hiddenBySubscription: false,
            ...(minPrice !== null && { pricePerUnit: { gte: minPrice } }),
            ...(maxPrice !== null && { pricePerUnit: { lte: maxPrice } }),
            ...(tags.length > 0 && { tags: { some: { slug: { in: tags } } } }),
          },
          include: { tags: true },
          take: 5,
        },
      },
      take: limit,
    });

    // Process results - add distance and min price
    let results = sellers.map((seller) => {
      const minListingPrice = seller.listings.length > 0
        ? Math.min(...seller.listings.map((l) => l.pricePerUnit))
        : null;

      let distance: number | null = null;
      if (lat !== null && lng !== null && seller.lat && seller.lng) {
        distance = calculateDistance(lat, lng, seller.lat, seller.lng);
      }

      return {
        id: seller.id,
        username: seller.user.username,
        displayName: seller.displayName,
        bio: seller.bio,
        avatarUrl: seller.avatarUrl,
        city: seller.city,
        state: seller.state,
        lat: seller.lat,
        lng: seller.lng,
        maxDeliveryDistance: seller.maxDeliveryDistance,
        isActive: seller.isActive,
        minPrice: minListingPrice,
        distance,
        canDeliver: lat !== null && lng !== null && seller.maxDeliveryDistance 
          ? (distance ?? Infinity) <= seller.maxDeliveryDistance 
          : seller.maxDeliveryDistance ? seller.maxDeliveryDistance > 0 : false,
        listings: seller.listings.map((listing) => ({
          id: listing.id,
          title: listing.title,
          description: listing.description,
          pricePerUnit: listing.pricePerUnit,
          unit: listing.unit,
          photos: listing.photos,
          tags: listing.tags.map((t) => ({ name: t.name, slug: t.slug })),
        })),
        createdAt: seller.createdAt,
        updatedAt: seller.updatedAt,
      };
    });

    // Sort results
    switch (sort) {
      case "distance":
        if (lat !== null && lng !== null) {
          results = results.sort((a, b) => {
            if (a.distance === null && b.distance === null) return 0;
            if (a.distance === null) return 1;
            if (b.distance === null) return -1;
            return a.distance - b.distance;
          });
        }
        break;
      case "price_asc":
        results = results.sort((a, b) => {
          if (a.minPrice === null && b.minPrice === null) return 0;
          if (a.minPrice === null) return 1;
          if (b.minPrice === null) return -1;
          return a.minPrice - b.minPrice;
        });
        break;
      case "price_desc":
        results = results.sort((a, b) => {
          if (a.minPrice === null && b.minPrice === null) return 0;
          if (a.minPrice === null) return 1;
          if (b.minPrice === null) return -1;
          return b.minPrice - a.minPrice;
        });
        break;
      case "newest":
        results = results.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        break;
      case "relevance":
      default:
        // If no search query, sort by newest; otherwise keep DB order (relevance)
        if (!q) {
          results = results.sort((a, b) => 
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        }
        break;
    }

    // Get all available tags for filter UI
    const allTags = await db.tag.findMany({
      where: {
        listings: {
          some: {
            isAvailable: true,
            hiddenBySubscription: false,
          },
        },
      },
      select: { name: true, slug: true },
    });

    return NextResponse.json({
      sellers: results,
      total: results.length,
      tags: allTags,
      filters: {
        q,
        lat,
        lng,
        tags,
        minPrice,
        maxPrice,
        delivery,
        sort,
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
