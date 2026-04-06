"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface SearchFilters {
  q: string;
  tags: string[];
  minPrice: number | null;
  maxPrice: number | null;
  delivery: boolean;
  sort: string;
  lat: number | null;
  lng: number | null;
  radius: number;
}

interface Seller {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  city: string;
  state: string;
  bio: string | null;
  lat: number | null;
  lng: number | null;
  maxDeliveryDistance: number | null;
  user: { username: string };
  listings: Array<{
    id: string;
    title: string;
    pricePerUnit: number;
    photos: string[];
    tags: Array<{ name: string; slug: string }>;
  }>;
  distance?: number;
}

interface UseSearchOptions {
  initialQuery?: string;
  initialTags?: string[];
  debounceMs?: number;
}

export function useSearch(options: UseSearchOptions = {}) {
  const { initialQuery = "", initialTags = [], debounceMs = 300 } = options;
  
  const [filters, setFilters] = useState<SearchFilters>({
    q: initialQuery,
    tags: initialTags,
    minPrice: null,
    maxPrice: null,
    delivery: false,
    sort: "relevance",
    lat: null,
    lng: null,
    radius: 25,
  });

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalResults, setTotalResults] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Search function
  const performSearch = useCallback(async (searchFilters: SearchFilters) => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchFilters.q) params.set("q", searchFilters.q);
      if (searchFilters.tags.length > 0) params.set("tags", searchFilters.tags.join(","));
      if (searchFilters.minPrice !== null) params.set("minPrice", String(searchFilters.minPrice));
      if (searchFilters.maxPrice !== null) params.set("maxPrice", String(searchFilters.maxPrice));
      if (searchFilters.delivery) params.set("delivery", "true");
      if (searchFilters.sort !== "relevance") params.set("sort", searchFilters.sort);
      if (searchFilters.lat !== null && searchFilters.lng !== null) {
        params.set("lat", String(searchFilters.lat));
        params.set("lng", String(searchFilters.lng));
        params.set("radius", String(searchFilters.radius));
      }

      const response = await fetch(`/api/search?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const data = await response.json();
      setSellers(data.sellers || []);
      setTotalResults(data.total || data.sellers?.length || 0);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError("Failed to search. Please try again.");
        console.error("Search error:", err);
      }
    } finally {
      if (controller === abortControllerRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Debounced search
  const debouncedSearch = useCallback((searchFilters: SearchFilters) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(searchFilters);
    }, debounceMs);
  }, [performSearch, debounceMs]);

  // Update individual filters
  const setQuery = useCallback((q: string) => {
    setFilters((prev) => {
      const next = { ...prev, q };
      debouncedSearch(next);
      return next;
    });
  }, [debouncedSearch]);

  const setTags = useCallback((tags: string[]) => {
    setFilters((prev) => {
      const next = { ...prev, tags };
      performSearch(next);
      return next;
    });
  }, [performSearch]);

  const setPriceRange = useCallback((minPrice: number | null, maxPrice: number | null) => {
    setFilters((prev) => {
      const next = { ...prev, minPrice, maxPrice };
      performSearch(next);
      return next;
    });
  }, [performSearch]);

  const setDelivery = useCallback((delivery: boolean) => {
    setFilters((prev) => {
      const next = { ...prev, delivery };
      performSearch(next);
      return next;
    });
  }, [performSearch]);

  const setSort = useCallback((sort: string) => {
    setFilters((prev) => {
      const next = { ...prev, sort };
      performSearch(next);
      return next;
    });
  }, [performSearch]);

  const setRadius = useCallback((radius: number) => {
    setFilters((prev) => {
      const next = { ...prev, radius };
      if (prev.lat !== null && prev.lng !== null) {
        performSearch(next);
      }
      return next;
    });
  }, [performSearch]);

  // Geolocation
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    setIsLoadingLocation(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setFilters((prev) => {
          const next = { 
            ...prev, 
            lat: latitude, 
            lng: longitude,
            sort: prev.sort === "relevance" ? "distance" : prev.sort,
          };
          performSearch(next);
          return next;
        });
        setIsLoadingLocation(false);
      },
      (err) => {
        setIsLoadingLocation(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError("Location permission denied. Please enable location access.");
            break;
          case err.POSITION_UNAVAILABLE:
            setError("Location unavailable. Please try again.");
            break;
          case err.TIMEOUT:
            setError("Location request timed out. Please try again.");
            break;
          default:
            setError("Failed to get location. Please try again.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
      }
    );
  }, [performSearch]);

  const clearLocation = useCallback(() => {
    setFilters((prev) => {
      const next = { 
        ...prev, 
        lat: null, 
        lng: null,
        sort: prev.sort === "distance" ? "relevance" : prev.sort,
      };
      performSearch(next);
      return next;
    });
  }, [performSearch]);

  // Initial search on mount
  useEffect(() => {
    performSearch(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    // State
    filters,
    sellers,
    isLoading,
    isLoadingLocation,
    error,
    totalResults,
    userLocation: filters.lat !== null && filters.lng !== null 
      ? { lat: filters.lat, lng: filters.lng }
      : null,

    // Actions
    setQuery,
    setTags,
    setPriceRange,
    setDelivery,
    setSort,
    setRadius,
    requestLocation,
    clearLocation,
    refresh: () => performSearch(filters),
  };
}
