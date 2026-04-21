"use client";

import { useState } from "react";
import { Filter, X, ChevronDown, ChevronUp, MapPin, Loader2 } from "lucide-react";
import { Button, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

interface Tag {
  name: string;
  slug: string;
}

interface SearchFiltersProps {
  tags: Tag[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  minPrice: number | null;
  maxPrice: number | null;
  onPriceChange: (min: number | null, max: number | null) => void;
  delivery: boolean;
  onDeliveryChange: (delivery: boolean) => void;
  sort: string;
  onSortChange: (sort: string) => void;
  userLocation: { lat: number; lng: number } | null;
  onLocationRequest: () => void;
  isLoadingLocation: boolean;
  onClearLocation: () => void;
}

const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "distance", label: "Distance" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "newest", label: "Newest" },
];

const PRICE_PRESETS = [
  { label: "Under $5", min: null, max: 5 },
  { label: "$5 - $10", min: 5, max: 10 },
  { label: "$10 - $15", min: 10, max: 15 },
  { label: "Over $15", min: 15, max: null },
];

export function SearchFilters({
  tags,
  selectedTags,
  onTagsChange,
  minPrice,
  maxPrice,
  onPriceChange,
  delivery,
  onDeliveryChange,
  sort,
  onSortChange,
  userLocation,
  onLocationRequest,
  isLoadingLocation,
  onClearLocation,
}: SearchFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const [customMax, setCustomMax] = useState("");

  const toggleTag = (slug: string) => {
    if (selectedTags.includes(slug)) {
      onTagsChange(selectedTags.filter((t) => t !== slug));
    } else {
      onTagsChange([...selectedTags, slug]);
    }
  };

  const applyCustomPrice = () => {
    const min = customMin ? parseFloat(customMin) : null;
    const max = customMax ? parseFloat(customMax) : null;
    onPriceChange(min, max);
  };

  const clearAllFilters = () => {
    onTagsChange([]);
    onPriceChange(null, null);
    onDeliveryChange(false);
    onSortChange("relevance");
    setCustomMin("");
    setCustomMax("");
  };

  const hasActiveFilters = selectedTags.length > 0 || minPrice !== null || maxPrice !== null || delivery;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-4 mb-6">
      {/* Quick filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "flex items-center gap-1",
            hasActiveFilters && "border-amber-500 bg-amber-50"
          )}
        >
          <Filter className="w-4 h-4" />
          Filters
          {hasActiveFilters && (
            <Badge variant="default" className="ml-1 px-1.5 py-0.5 text-xs">
              {selectedTags.length + (minPrice !== null || maxPrice !== null ? 1 : 0) + (delivery ? 1 : 0)}
            </Badge>
          )}
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>

        {/* Location button */}
        <Button
          variant={userLocation ? "primary" : "outline"}
          size="sm"
          onClick={userLocation ? onClearLocation : onLocationRequest}
          disabled={isLoadingLocation}
          className="flex items-center gap-1"
        >
          {isLoadingLocation ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MapPin className="w-4 h-4" />
          )}
          {userLocation ? "Near Me" : "Use My Location"}
          {userLocation && <X className="w-3 h-3 ml-1" />}
        </Button>

        {/* Quick tag filters */}
        {tags.slice(0, 5).map((tag) => (
          <Button
            key={tag.slug}
            variant={selectedTags.includes(tag.slug) ? "primary" : "outline"}
            size="sm"
            onClick={() => toggleTag(tag.slug)}
          >
            {tag.name}
          </Button>
        ))}

        {/* Delivery filter */}
        <Button
          variant={delivery ? "primary" : "outline"}
          size="sm"
          onClick={() => onDeliveryChange(!delivery)}
        >
          Delivery
        </Button>

        {/* Sort dropdown */}
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="h-9 px-3 text-sm rounded-lg border border-amber-200 bg-white text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} disabled={option.value === "distance" && !userLocation}>
              {option.label}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-amber-600">
            Clear all
          </Button>
        )}
      </div>

      {/* Expanded filters */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-amber-100 grid gap-4 md:grid-cols-3">
          {/* Tags */}
          <div>
            <h4 className="text-sm font-medium text-amber-900 mb-2">Egg Type</h4>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.slug}
                  onClick={() => toggleTag(tag.slug)}
                  className={cn(
                    "px-3 py-1 text-sm rounded-full border transition-colors",
                    selectedTags.includes(tag.slug)
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-amber-700 border-amber-200 hover:border-amber-400"
                  )}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>

          {/* Price range */}
          <div>
            <h4 className="text-sm font-medium text-amber-900 mb-2">Price Range</h4>
            <div className="flex flex-wrap gap-2 mb-2">
              {PRICE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => onPriceChange(preset.min, preset.max)}
                  className={cn(
                    "px-3 py-1 text-sm rounded-full border transition-colors",
                    minPrice === preset.min && maxPrice === preset.max
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-amber-700 border-amber-200 hover:border-amber-400"
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder="Min"
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                className="w-20 px-2 py-1 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-amber-400">—</span>
              <input
                type="number"
                placeholder="Max"
                value={customMax}
                onChange={(e) => setCustomMax(e.target.value)}
                className="w-20 px-2 py-1 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <Button size="sm" variant="outline" onClick={applyCustomPrice}>
                Apply
              </Button>
            </div>
          </div>

          {/* Active filters summary */}
          <div>
            <h4 className="text-sm font-medium text-amber-900 mb-2">Active Filters</h4>
            {!hasActiveFilters ? (
              <p className="text-sm text-amber-500">No filters applied</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {selectedTags.map((slug) => {
                  const tag = tags.find((t) => t.slug === slug);
                  return (
                    <Badge
                      key={slug}
                      variant="default"
                      className="flex items-center gap-1 cursor-pointer"
                      onClick={() => toggleTag(slug)}
                    >
                      {tag?.name || slug}
                      <X className="w-3 h-3" />
                    </Badge>
                  );
                })}
                {(minPrice !== null || maxPrice !== null) && (
                  <Badge
                    variant="default"
                    className="flex items-center gap-1 cursor-pointer"
                    onClick={() => onPriceChange(null, null)}
                  >
                    ${minPrice ?? 0} - ${maxPrice ?? "∞"}
                    <X className="w-3 h-3" />
                  </Badge>
                )}
                {delivery && (
                  <Badge
                    variant="default"
                    className="flex items-center gap-1 cursor-pointer"
                    onClick={() => onDeliveryChange(false)}
                  >
                    Delivery
                    <X className="w-3 h-3" />
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
