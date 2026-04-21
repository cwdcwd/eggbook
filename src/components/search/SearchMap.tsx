"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatPrice } from "@/lib/utils";

interface Seller {
  id: string;
  displayName: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  user: { username: string };
  listings: Array<{
    id: string;
    title: string;
    pricePerUnit: number;
    photos: string[];
  }>;
  distance?: number;
}

interface SearchMapProps {
  sellers: Seller[];
  userLocation: { lat: number; lng: number } | null;
  onSellerClick?: (seller: Seller) => void;
  className?: string;
}

// Custom marker icons
const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: "custom-marker",
    html: `
      <div style="
        background-color: ${color};
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <span style="transform: rotate(45deg); font-size: 14px;">🥚</span>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
};

const userIcon = L.divIcon({
  className: "user-marker",
  html: `
    <div style="
      background-color: #3b82f6;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export function SearchMap({ sellers, userLocation, onSellerClick, className }: SearchMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Initialize map
    const map = L.map(mapContainerRef.current, {
      center: userLocation ? [userLocation.lat, userLocation.lng] : [39.8283, -98.5795], // Default to US center
      zoom: userLocation ? 10 : 4,
      zoomControl: true,
    });

    // Add tile layer (OpenStreetMap)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update user location marker
  useEffect(() => {
    if (!mapRef.current) return;

    if (userLocation) {
      // Add or update user marker
      const existingUserMarker = markersRef.current.find((m) => (m as any)._isUserMarker);
      if (existingUserMarker) {
        existingUserMarker.setLatLng([userLocation.lat, userLocation.lng]);
      } else {
        const marker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
          .addTo(mapRef.current)
          .bindPopup("You are here");
        (marker as any)._isUserMarker = true;
        markersRef.current.push(marker);
      }

      mapRef.current.setView([userLocation.lat, userLocation.lng], 10);
    }
  }, [userLocation]);

  // Update seller markers
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove old seller markers (keep user marker)
    markersRef.current = markersRef.current.filter((marker) => {
      if ((marker as any)._isUserMarker) return true;
      marker.remove();
      return false;
    });

    // Add new seller markers
    const bounds: L.LatLngBoundsExpression = [];
    const sellerIcon = createCustomIcon("#f59e0b"); // amber-500

    sellers.forEach((seller) => {
      if (seller.lat && seller.lng) {
        const marker = L.marker([seller.lat, seller.lng], { icon: sellerIcon })
          .addTo(mapRef.current!);

        // Create popup content
        const minPrice = seller.listings.length > 0
          ? Math.min(...seller.listings.map((l) => l.pricePerUnit))
          : null;

        const popupContent = `
          <div style="min-width: 180px;">
            <h3 style="font-weight: 600; margin-bottom: 4px;">${seller.displayName}</h3>
            <p style="color: #78716c; font-size: 12px; margin-bottom: 4px;">@${seller.user.username}</p>
            <p style="font-size: 12px; margin-bottom: 4px;">${seller.city}, ${seller.state}</p>
            ${seller.distance ? `<p style="font-size: 12px; color: #78716c;">${seller.distance.toFixed(1)} mi away</p>` : ""}
            ${minPrice ? `<p style="font-size: 14px; font-weight: 500; color: #f59e0b;">From ${formatPrice(minPrice)}/dz</p>` : ""}
            <a href="/@${seller.user.username}" style="
              display: block;
              margin-top: 8px;
              padding: 6px 12px;
              background: #f59e0b;
              color: white;
              text-align: center;
              border-radius: 6px;
              text-decoration: none;
              font-size: 14px;
            ">View Profile</a>
          </div>
        `;

        marker.bindPopup(popupContent);

        if (onSellerClick) {
          marker.on("click", () => onSellerClick(seller));
        }

        markersRef.current.push(marker);
        bounds.push([seller.lat, seller.lng]);
      }
    });

    // Add user location to bounds if present
    if (userLocation) {
      bounds.push([userLocation.lat, userLocation.lng]);
    }

    // Fit bounds if we have markers
    if (bounds.length > 0) {
      mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [50, 50] });
    }
  }, [sellers, onSellerClick, userLocation]);

  return (
    <div
      ref={mapContainerRef}
      className={className}
      style={{ minHeight: "400px", width: "100%" }}
    />
  );
}
