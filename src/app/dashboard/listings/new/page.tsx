"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload, X, Plus } from "lucide-react";
import { Button, Input, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui";

const PRICING_UNITS = [
  { value: "EGG", label: "Per Egg" },
  { value: "HALF_DOZEN", label: "Per Half Dozen (6)" },
  { value: "DOZEN", label: "Per Dozen (12)" },
  { value: "FLAT", label: "Per Flat (30)" },
  { value: "CUSTOM", label: "Custom Unit" },
];

const SUGGESTED_TAGS = [
  "Chicken",
  "Duck",
  "Quail",
  "Goose",
  "Turkey",
  "Organic",
  "Free-Range",
  "Pasture-Raised",
  "Brown",
  "White",
  "Blue/Green",
  "Jumbo",
  "Large",
  "Medium",
];

export default function NewListingPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [pricingUnit, setPricingUnit] = useState("DOZEN");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    pricePerUnit: "",
    customUnitName: "",
    customUnitQty: "",
    stockCount: "",
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    // Upload each file to Vercel Blob via our API
    const uploadPromises = Array.from(files).map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        throw new Error("Failed to upload photo");
      }
      
      const { url } = await res.json();
      return url;
    });

    try {
      const uploadedUrls = await Promise.all(uploadPromises);
      setPhotos((prev) => [...prev, ...uploadedUrls].slice(0, 5));
    } catch (error) {
      console.error("Failed to upload photos:", error);
      alert("Failed to upload one or more photos. Please try again.");
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    if (customTag && !selectedTags.includes(customTag)) {
      setSelectedTags((prev) => [...prev, customTag]);
      setCustomTag("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          pricePerUnit: formData.pricePerUnit,
          unit: pricingUnit,
          customUnitName: formData.customUnitName,
          customUnitQty: formData.customUnitQty,
          stockCount: formData.stockCount,
          photos,
          tags: selectedTags,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create listing");
      }

      router.push("/dashboard/listings");
    } catch (error) {
      console.error("Failed to create listing:", error);
      alert(error instanceof Error ? error.message : "Failed to create listing");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/listings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-amber-900">Create New Listing</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Photos */}
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-4">
              {photos.map((photo, index) => (
                <div key={index} className="relative aspect-square rounded-lg overflow-hidden bg-amber-100">
                  <img
                    src={photo}
                    alt={`Photo ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <label className="aspect-square rounded-lg border-2 border-dashed border-amber-300 flex flex-col items-center justify-center cursor-pointer hover:border-amber-500 transition-colors">
                  <Upload className="w-6 h-6 text-amber-400" />
                  <span className="text-xs text-amber-500 mt-1">Add Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            <p className="text-sm text-amber-500 mt-2">
              Add up to 5 photos. First photo will be the cover.
            </p>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Title"
              placeholder="e.g., Farm Fresh Chicken Eggs"
              value={formData.title}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, title: e.target.value }))
              }
              required
            />
            <div>
              <label className="block text-sm font-medium text-amber-900 mb-1">
                Description
              </label>
              <textarea
                placeholder="Describe your eggs..."
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                className="w-full h-24 px-3 py-2 rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {/* Tags */}
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mb-4">
              {SUGGESTED_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    selectedTags.includes(tag)
                      ? "bg-amber-500 text-white"
                      : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add custom tag..."
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addCustomTag())}
              />
              <Button type="button" variant="outline" onClick={addCustomTag}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {selectedTags.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-amber-600 mb-2">Selected tags:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedTags.map((tag) => (
                    <Badge key={tag} className="flex items-center gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className="ml-1 hover:text-red-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pricing */}
        <Card>
          <CardHeader>
            <CardTitle>Pricing & Inventory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-amber-900 mb-1">
                Pricing Unit
              </label>
              <select
                value={pricingUnit}
                onChange={(e) => setPricingUnit(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                {PRICING_UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </div>

            {pricingUnit === "CUSTOM" && (
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Custom Unit Name"
                  placeholder="e.g., Carton"
                  value={formData.customUnitName}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, customUnitName: e.target.value }))
                  }
                />
                <Input
                  label="Eggs per Unit"
                  type="number"
                  placeholder="e.g., 18"
                  value={formData.customUnitQty}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, customUnitQty: e.target.value }))
                  }
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Price"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.pricePerUnit}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, pricePerUnit: e.target.value }))
                }
                required
              />
              <Input
                label="Stock Count"
                type="number"
                min="0"
                placeholder="0"
                value={formData.stockCount}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, stockCount: e.target.value }))
                }
                hint="Number of units available"
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-4">
          <Link href="/dashboard/listings" className="flex-1">
            <Button type="button" variant="outline" className="w-full">
              Cancel
            </Button>
          </Link>
          <Button type="submit" className="flex-1" isLoading={isLoading}>
            Create Listing
          </Button>
        </div>
      </form>
    </div>
  );
}
