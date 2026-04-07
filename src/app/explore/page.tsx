"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Search, MapPin, Heart, MessageSquare, Grid, List, Map, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { SearchFilters } from "@/components/search/SearchFilters";
import { SearchResults } from "@/components/search/SearchResults";
import dynamic from "next/dynamic";

// Dynamically import map to avoid SSR issues with Leaflet
const SearchMap = dynamic(
  () => import("@/components/search/SearchMap").then((mod) => mod.SearchMap),
  { 
    ssr: false,
    loading: () => (
      <div className="h-[400px] bg-amber-100 animate-pulse rounded-xl flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    ),
  }
);

interface Tag {
  name: string;
  slug: string;
}

interface Listing {
  id: string;
  title: string;
  pricePerUnit: number;
  photos: string[];
  tags: Tag[];
}

interface Seller {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  maxDeliveryDistance: number | null;
  minPrice: number | null;
  distance?: number;
  canDeliver: boolean;
  listings: Listing[];
  user: { username: string };
}

function ExploreContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId } = useAuth();
  
  // Search state
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [selectedTags, setSelectedTags] = useState<string[]>(
    searchParams.get("tags")?.split(",").filter(Boolean) || []
  );
  const [minPrice, setMinPrice] = useState<number | null>(
    searchParams.get("minPrice") ? parseFloat(searchParams.get("minPrice")!) : null
  );
  const [maxPrice, setMaxPrice] = useState<number | null>(
    searchParams.get("maxPrice") ? parseFloat(searchParams.get("maxPrice")!) : null
  );
  const [delivery, setDelivery] = useState(searchParams.get("delivery") === "true");
  const [sort, setSort] = useState(searchParams.get("sort") || "relevance");
  
  // Location state
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  
  // View state
  const [view, setView] = useState<"grid" | "list" | "map">("grid");
  
  // Results state
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [favorites, setFavorites] = useState<string[]>([]);

  // Build search URL params
  const buildSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
    if (minPrice !== null) params.set("minPrice", minPrice.toString());
    if (maxPrice !== null) params.set("maxPrice", maxPrice.toString());
    if (delivery) params.set("delivery", "true");
    if (sort !== "relevance") params.set("sort", sort);
    if (userLocation) {
      params.set("lat", userLocation.lat.toString());
      params.set("lng", userLocation.lng.toString());
    }
    return params;
  }, [query, selectedTags, minPrice, maxPrice, delivery, sort, userLocation]);

  // Fetch search results
  const fetchResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = buildSearchParams();
      const res = await fetch(`/api/search?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        // Map API response to component format
        const mappedSellers = data.sellers.map((s: any) => ({
          ...s,
          user: { username: s.username },
          distance: s.distance ?? undefined, // Convert null to undefined
          listings: s.listings.map((l: any) => ({
            ...l,
            tags: l.tags || [],
          })),
        }));
        setSellers(mappedSellers);
        setTags(data.tags || []);
      }
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [buildSearchParams]);

  // Initial load and search when params change
  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // Update URL when filters change (debounced)
  useEffect(() => {
    const params = buildSearchParams();
    const newUrl = params.toString() ? `/explore?${params.toString()}` : "/explore";
    router.replace(newUrl, { scroll: false });
  }, [buildSearchParams, router]);

  // Request user location
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setIsLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setIsLoadingLocation(false);
        // Auto-sort by distance when location is enabled
        if (sort === "relevance") {
          setSort("distance");
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        alert("Unable to get your location. Please check your browser settings.");
        setIsLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [sort]);

  // Clear location
  const clearLocation = useCallback(() => {
    setUserLocation(null);
    if (sort === "distance") {
      setSort("relevance");
    }
  }, [sort]);

  // Handle price change
  const handlePriceChange = useCallback((min: number | null, max: number | null) => {
    setMinPrice(min);
    setMaxPrice(max);
  }, []);

  // Handle search submit
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchResults();
  };

  // Toggle favorite
  const handleFavorite = useCallback(async (sellerId: string) => {
    if (!userId) {
      router.push("/sign-in");
      return;
    }

    try {
      const isFavorite = favorites.includes(sellerId);
      const res = await fetch("/api/favorites", {
        method: isFavorite ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId }),
      });

      if (res.ok) {
        setFavorites((prev) =>
          isFavorite
            ? prev.filter((id) => id !== sellerId)
            : [...prev, sellerId]
        );
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  }, [userId, favorites, router]);

  // Fetch user's favorites
  useEffect(() => {
    if (!userId) return;

    fetch("/api/favorites")
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        if (Array.isArray(data)) {
          setFavorites(data.map((f: any) => f.sellerId));
        }
      })
      .catch(() => {});
  }, [userId]);

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
              {userId ? (
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
        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-2 bg-white rounded-full p-2 shadow-lg border border-amber-200 max-w-2xl mx-auto">
            <div className="flex-1 flex items-center gap-2 px-4">
              <Search className="w-5 h-5 text-amber-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by location, eggs, seller..."
                className="flex-1 outline-none text-gray-700"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-amber-400 hover:text-amber-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Button type="submit" className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              <span className="hidden sm:inline">Search</span>
            </Button>
          </div>
        </form>

        {/* Filters */}
        <SearchFilters
          tags={tags}
          selectedTags={selectedTags}
          onTagsChange={setSelectedTags}
          minPrice={minPrice}
          maxPrice={maxPrice}
          onPriceChange={handlePriceChange}
          delivery={delivery}
          onDeliveryChange={setDelivery}
          sort={sort}
          onSortChange={setSort}
          userLocation={userLocation}
          onLocationRequest={requestLocation}
          isLoadingLocation={isLoadingLocation}
          onClearLocation={clearLocation}
        />

        {/* View Toggle & Results Count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-amber-600">
            {isLoading ? (
              "Searching..."
            ) : (
              <>
                <span className="font-medium">{sellers.length}</span> seller{sellers.length !== 1 ? "s" : ""} found
                {userLocation && " near you"}
              </>
            )}
          </p>
          
          <div className="flex items-center gap-1 bg-white rounded-lg border border-amber-200 p-1">
            <button
              onClick={() => setView("grid")}
              className={`p-2 rounded ${view === "grid" ? "bg-amber-100 text-amber-700" : "text-amber-500 hover:text-amber-700"}`}
              title="Grid view"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={`p-2 rounded ${view === "list" ? "bg-amber-100 text-amber-700" : "text-amber-500 hover:text-amber-700"}`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView("map")}
              className={`p-2 rounded ${view === "map" ? "bg-amber-100 text-amber-700" : "text-amber-500 hover:text-amber-700"}`}
              title="Map view"
            >
              <Map className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Results */}
        {view === "map" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-[500px] rounded-xl overflow-hidden border border-amber-200">
              <SearchMap
                sellers={sellers.map((s) => ({
                  ...s,
                  user: { username: s.username },
                }))}
                userLocation={userLocation}
                className="h-full"
              />
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <SearchResults
                sellers={sellers}
                isLoading={isLoading}
                view="list"
                onFavorite={handleFavorite}
                favorites={favorites}
              />
            </div>
          </div>
        ) : (
          <SearchResults
            sellers={sellers}
            isLoading={isLoading}
            view={view}
            onFavorite={handleFavorite}
            favorites={favorites}
          />
        )}
      </main>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-amber-500 mx-auto mb-4" />
          <p className="text-amber-600">Loading explore...</p>
        </div>
      </div>
    }>
      <ExploreContent />
    </Suspense>
  );
}
