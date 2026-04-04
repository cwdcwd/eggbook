"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui";
import { MapPin, CreditCard, Clock, Save, Check, AlertCircle, Loader2, Upload, X, ShoppingCart } from "lucide-react";

const PICKUP_TYPES = [
  { value: "TIMESLOT", label: "Specific Time Slots", description: "Buyers select from your available time slots" },
  { value: "HOURS", label: "Available Hours", description: "Display your available hours, buyers arrange pickup" },
  { value: "ARRANGED", label: "Arranged After Order", description: "Coordinate pickup time after order is confirmed" },
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isConnectingStripe, setIsConnectingStripe] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<{
    connected: boolean;
    onboarded: boolean;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
  }>({ connected: false, onboarded: false });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  const [profile, setProfile] = useState({
    displayName: "",
    bio: "",
    avatarUrl: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    maxDeliveryDistance: "",
    pickupType: "ARRANGED",
    paymentMethod: "PLATFORM",
    autoAcceptOrders: true,
  });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        throw new Error("Failed to upload image");
      }
      
      const { url } = await res.json();
      setProfile((prev) => ({ ...prev, avatarUrl: url }));
    } catch (error) {
      console.error("Failed to upload avatar:", error);
      setMessage({ type: "error", text: "Failed to upload image. Please try again." });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

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
              avatarUrl: data.sellerProfile.avatarUrl || "",
              address: data.sellerProfile.address || "",
              city: data.sellerProfile.city || "",
              state: data.sellerProfile.state || "",
              zip: data.sellerProfile.zip || "",
              maxDeliveryDistance: data.sellerProfile.maxDeliveryDistance?.toString() || "",
              pickupType: data.sellerProfile.pickupType || "ARRANGED",
              paymentMethod: data.sellerProfile.paymentMethod || "PLATFORM",
              autoAcceptOrders: data.sellerProfile.autoAcceptOrders ?? true,
            });
          }
        }

        // Check Stripe status
        const stripeRes = await fetch("/api/stripe");
        if (stripeRes.ok) {
          const stripeData = await stripeRes.json();
          setStripeStatus(stripeData);
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  // Handle Stripe return
  useEffect(() => {
    const stripeParam = searchParams.get("stripe");
    if (stripeParam === "success") {
      setMessage({ type: "success", text: "Stripe account connected successfully!" });
      // Refresh Stripe status
      fetch("/api/stripe").then(res => res.json()).then(setStripeStatus);
    } else if (stripeParam === "refresh") {
      setMessage({ type: "error", text: "Stripe setup incomplete. Please try again." });
    }
  }, [searchParams]);

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
    setIsConnectingStripe(true);
    try {
      const res = await fetch("/api/stripe", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start Stripe setup");
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error("Error connecting Stripe:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to connect Stripe",
      });
      setIsConnectingStripe(false);
    }
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
          {/* Profile Photo/Logo */}
          <div>
            <label className="block text-sm font-medium text-amber-900 mb-2">
              Profile Photo / Logo
            </label>
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 rounded-full overflow-hidden bg-amber-100 flex items-center justify-center">
                {profile.avatarUrl ? (
                  <>
                    <img
                      src={profile.avatarUrl}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setProfile((prev) => ({ ...prev, avatarUrl: "" }))}
                      className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <span className="text-4xl">🥚</span>
                )}
              </div>
              <div>
                <label className="cursor-pointer">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isUploadingAvatar}
                    onClick={() => document.getElementById("avatar-upload")?.click()}
                  >
                    {isUploadingAvatar ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Photo
                      </>
                    )}
                  </Button>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </label>
                <p className="text-xs text-amber-500 mt-1">
                  Recommended: Square image, at least 200x200px
                </p>
              </div>
            </div>
          </div>

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

      {/* Order Preferences */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-500" />
            <CardTitle>Order Preferences</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
              profile.autoAcceptOrders
                ? "border-amber-500 bg-amber-50"
                : "border-amber-200 hover:border-amber-300"
            }`}
          >
            <input
              type="checkbox"
              checked={profile.autoAcceptOrders}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, autoAcceptOrders: e.target.checked }))
              }
              className="mt-1 w-5 h-5 text-amber-500 rounded border-amber-300 focus:ring-amber-500"
            />
            <div>
              <p className="font-medium text-amber-900">Auto-Accept Orders</p>
              <p className="text-sm text-amber-600">
                Automatically confirm incoming orders so buyers can pay immediately. 
                If disabled, you&apos;ll need to manually confirm each order before buyers can checkout.
              </p>
            </div>
          </label>
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
        <CardContent className="space-y-6">
          {/* Payment Method Selection */}
          <div className="space-y-4">
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                profile.paymentMethod === "PLATFORM"
                  ? "border-amber-500 bg-amber-50"
                  : "border-amber-200 hover:border-amber-300"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value="PLATFORM"
                checked={profile.paymentMethod === "PLATFORM"}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, paymentMethod: e.target.value }))
                }
                className="mt-1"
              />
              <div>
                <p className="font-medium text-amber-900">Eggbook Handles Payments</p>
                <p className="text-sm text-amber-600">
                  We collect payments from buyers and pay you out. Simplest option - no Stripe account needed.
                </p>
              </div>
            </label>
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                profile.paymentMethod === "OWN_STRIPE"
                  ? "border-amber-500 bg-amber-50"
                  : "border-amber-200 hover:border-amber-300"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value="OWN_STRIPE"
                checked={profile.paymentMethod === "OWN_STRIPE"}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, paymentMethod: e.target.value }))
                }
                className="mt-1"
              />
              <div>
                <p className="font-medium text-amber-900">Connect Your Own Stripe</p>
                <p className="text-sm text-amber-600">
                  Payments go directly to your Stripe account. You manage refunds and payouts.
                </p>
              </div>
            </label>
          </div>

          {/* Stripe Connect UI (only shown if OWN_STRIPE selected) */}
          {profile.paymentMethod === "OWN_STRIPE" && (
            <div className="pt-4 border-t border-amber-200">
              {stripeStatus.onboarded ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {stripeStatus.chargesEnabled ? (
                      <>
                        <Badge variant="success">Connected</Badge>
                        <span className="text-sm text-amber-600">
                          Your Stripe account is ready to receive payments
                        </span>
                      </>
                    ) : (
                      <>
                        <Badge variant="warning">Pending Verification</Badge>
                        <span className="text-sm text-amber-600">
                          Stripe is verifying your account. Payments will be enabled soon.
                        </span>
                      </>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={connectStripe}>
                    Manage
                  </Button>
                </div>
              ) : stripeStatus.connected ? (
                <div className="text-center py-4">
                  <Badge variant="warning" className="mb-2">Setup Incomplete</Badge>
                  <p className="text-amber-600 mb-4">
                    Your Stripe account is connected but setup is incomplete.
                  </p>
                  <Button onClick={connectStripe} disabled={isConnectingStripe}>
                    {isConnectingStripe ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 mr-2" />
                    )}
                    Complete Setup
                  </Button>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-amber-600 mb-4">
                    Connect your Stripe account to receive payments directly.
                  </p>
                  <Button onClick={connectStripe} disabled={isConnectingStripe}>
                    {isConnectingStripe ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 mr-2" />
                    )}
                    Connect Stripe
                  </Button>
                </div>
              )}
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

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
