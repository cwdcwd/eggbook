"use client";

import { useState, useEffect } from "react";
import { Button, Input, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui";
import { MapPin, CreditCard, Clock, Save, Check, AlertCircle } from "lucide-react";

const PICKUP_TYPES = [
  { value: "TIMESLOT", label: "Specific Time Slots", description: "Buyers select from your available time slots" },
  { value: "HOURS", label: "Available Hours", description: "Display your available hours, buyers arrange pickup" },
  { value: "ARRANGED", label: "Arranged After Order", description: "Coordinate pickup time after order is confirmed" },
];

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  const [profile, setProfile] = useState({
    displayName: "",
    bio: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    maxDeliveryDistance: "",
    pickupType: "ARRANGED",
  });

  // Load existing profile on mount
  useEffect(() => {
    async function loadSettings() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.sellerProfile) {
            setProfile({
              displayName: data.sellerProfile.displayName || "",
              bio: data.sellerProfile.bio || "",
              address: data.sellerProfile.address || "",
              city: data.sellerProfile.city || "",
              state: data.sellerProfile.state || "",
              zip: data.sellerProfile.zip || "",
              maxDeliveryDistance: data.sellerProfile.maxDeliveryDistance?.toString() || "",
              pickupType: data.sellerProfile.pickupType || "ARRANGED",
            });
            setStripeConnected(data.sellerProfile.stripeOnboarded || false);
          }
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Settings saved successfully!" });
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to save settings" });
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setIsSaving(false);
    }
  };

  const connectStripe = async () => {
    // TODO: Redirect to Stripe Connect onboarding
    console.log("Connecting Stripe...");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-amber-900">Settings</h1>
        <p className="text-amber-600">Manage your seller profile and preferences</p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Display Name"
            placeholder="Your farm or seller name"
            value={profile.displayName}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, displayName: e.target.value }))
            }
          />
          <div>
            <label className="block text-sm font-medium text-amber-900 mb-1">
              Bio
            </label>
            <textarea
              placeholder="Tell buyers about yourself and your eggs..."
              value={profile.bio}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, bio: e.target.value }))
              }
              className="w-full h-24 px-3 py-2 rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Location */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-amber-500" />
            <CardTitle>Location</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Address"
            placeholder="Street address"
            value={profile.address}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, address: e.target.value }))
            }
          />
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="City"
              placeholder="City"
              value={profile.city}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, city: e.target.value }))
              }
            />
            <Input
              label="State"
              placeholder="State"
              value={profile.state}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, state: e.target.value }))
              }
            />
            <Input
              label="ZIP"
              placeholder="ZIP code"
              value={profile.zip}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, zip: e.target.value }))
              }
            />
          </div>
          <Input
            label="Max Delivery Distance (miles)"
            type="number"
            min="0"
            placeholder="e.g., 10"
            value={profile.maxDeliveryDistance}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, maxDeliveryDistance: e.target.value }))
            }
            hint="Leave empty for pickup only"
          />
        </CardContent>
      </Card>

      {/* Pickup Preferences */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            <CardTitle>Pickup Preferences</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {PICKUP_TYPES.map((type) => (
            <label
              key={type.value}
              className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                profile.pickupType === type.value
                  ? "border-amber-500 bg-amber-50"
                  : "border-amber-200 hover:border-amber-300"
              }`}
            >
              <input
                type="radio"
                name="pickupType"
                value={type.value}
                checked={profile.pickupType === type.value}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, pickupType: e.target.value }))
                }
                className="mt-1"
              />
              <div>
                <p className="font-medium text-amber-900">{type.label}</p>
                <p className="text-sm text-amber-600">{type.description}</p>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* Stripe Connect */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-amber-500" />
            <CardTitle>Payment Setup</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {stripeConnected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="success">Connected</Badge>
                <span className="text-sm text-amber-600">
                  Your Stripe account is connected
                </span>
              </div>
              <Button variant="outline" size="sm">
                Manage
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-amber-600 mb-4">
                Connect your Stripe account to receive payments from buyers.
              </p>
              <Button onClick={connectStripe}>
                <CreditCard className="w-4 h-4 mr-2" />
                Connect Stripe
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="space-y-4">
        {message && (
          <div
            className={`flex items-center gap-2 p-4 rounded-lg ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {message.type === "success" ? (
              <Check className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            {message.text}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} isLoading={isSaving}>
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
