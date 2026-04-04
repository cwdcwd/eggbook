import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";

// Allowed URL patterns for avatar sync (SSRF protection)
const ALLOWED_AVATAR_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.blob\.vercel-storage\.com\/.+$/i, // Vercel Blob
  /^https:\/\/images\.clerk\.dev\/.+$/i, // Clerk images
  /^https:\/\/img\.clerk\.com\/.+$/i, // Clerk images (alternate)
];

function isAllowedAvatarUrl(url: string): boolean {
  return ALLOWED_AVATAR_PATTERNS.some((pattern) => pattern.test(url));
}

// Get current user's seller profile
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Sync Clerk avatar to seller profile only if no avatar is set yet
    let sellerProfile = user.sellerProfile;
    if (sellerProfile && !sellerProfile.avatarUrl) {
      const clerkUser = await currentUser();
      if (clerkUser?.imageUrl) {
        sellerProfile = await db.sellerProfile.update({
          where: { id: sellerProfile.id },
          data: { avatarUrl: clerkUser.imageUrl },
        });
      }
    }

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      sellerProfile,
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// Update seller profile settings
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      displayName,
      bio,
      avatarUrl,
      address,
      city,
      state,
      zip,
      maxDeliveryDistance,
      pickupType,
      paymentMethod,
    } = body;

    // Validate required fields
    if (!displayName || displayName.trim() === "") {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    // Parse maxDeliveryDistance
    const maxDeliveryDistanceFloat = maxDeliveryDistance
      ? parseFloat(maxDeliveryDistance)
      : null;

    // Upsert seller profile (create if doesn't exist)
    const sellerProfile = await db.sellerProfile.upsert({
      where: { userId: user.id },
      update: {
        displayName: displayName.trim(),
        bio: bio?.trim() || null,
        avatarUrl: avatarUrl || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        zip: zip?.trim() || null,
        maxDeliveryDistance: maxDeliveryDistanceFloat,
        pickupType: pickupType || "ARRANGED",
        paymentMethod: paymentMethod || "PLATFORM",
      },
      create: {
        userId: user.id,
        displayName: displayName.trim(),
        bio: bio?.trim() || null,
        avatarUrl: avatarUrl || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        zip: zip?.trim() || null,
        maxDeliveryDistance: maxDeliveryDistanceFloat,
        pickupType: pickupType || "ARRANGED",
        paymentMethod: paymentMethod || "PLATFORM",
      },
    });

    // Sync avatar to Clerk profile if it changed (with SSRF protection)
    const previousAvatarUrl = user.sellerProfile?.avatarUrl;
    if (avatarUrl && avatarUrl !== previousAvatarUrl && isAllowedAvatarUrl(avatarUrl)) {
      try {
        // Fetch with redirect:manual to prevent SSRF via redirect to internal hosts
        const response = await fetch(avatarUrl, { redirect: "manual" });
        
        // Reject redirects and non-OK responses
        if (!response.ok || response.status >= 300) {
          throw new Error(`Invalid response: ${response.status}`);
        }
        
        // Validate content type is an image
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) {
          throw new Error(`Invalid content type: ${contentType}`);
        }
        
        // Enforce size limit (5MB max)
        const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
        const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB
        if (contentLength > MAX_AVATAR_SIZE) {
          throw new Error(`Avatar too large: ${contentLength} bytes`);
        }
        
        const blob = await response.blob();
        
        // Double-check blob size (content-length can be missing/wrong)
        if (blob.size > MAX_AVATAR_SIZE) {
          throw new Error(`Avatar too large: ${blob.size} bytes`);
        }
        
        const file = new File([blob], "avatar.jpg", { type: blob.type });
        await clerkClient.users.updateUserProfileImage(userId, { file });
      } catch (err) {
        console.error("Failed to sync avatar to Clerk:", err);
        // Don't fail the request if Clerk sync fails
      }
    }

    // Update user role to SELLER if not already
    if (user.role !== "SELLER" && user.role !== "ADMIN") {
      await db.user.update({
        where: { id: user.id },
        data: { role: "SELLER" },
      });
    }

    return NextResponse.json(sellerProfile);
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
