import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { createConnectAccount, createAccountLink, getAccountStatus } from "@/lib/stripe";

// Start Stripe Connect onboarding
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Must have seller profile
    if (!user.sellerProfile) {
      return NextResponse.json(
        { error: "Create a seller profile first" },
        { status: 400 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    let stripeAccountId = user.sellerProfile.stripeAccountId;

    // Create Stripe account if doesn't exist
    if (!stripeAccountId) {
      const account = await createConnectAccount(user.email);
      stripeAccountId = account.id;

      // Save Stripe account ID
      await db.sellerProfile.update({
        where: { id: user.sellerProfile.id },
        data: { stripeAccountId },
      });
    }

    // Create onboarding link
    const onboardingUrl = await createAccountLink(
      stripeAccountId,
      `${baseUrl}/dashboard/settings?stripe=refresh`,
      `${baseUrl}/dashboard/settings?stripe=success`
    );

    return NextResponse.json({ url: onboardingUrl });
  } catch (error) {
    console.error("Error starting Stripe onboarding:", error);
    const message = error instanceof Error ? error.message : "Failed to start Stripe onboarding";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// Get Stripe account status
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    if (!user || !user.sellerProfile) {
      return NextResponse.json({ connected: false });
    }

    if (!user.sellerProfile.stripeAccountId) {
      return NextResponse.json({ connected: false });
    }

    // Get account status from Stripe
    const status = await getAccountStatus(user.sellerProfile.stripeAccountId);
    console.log("Stripe account status:", user.sellerProfile.stripeAccountId, status);

    // Update onboarded status if details are submitted (even if charges not yet enabled)
    if (status.detailsSubmitted && !user.sellerProfile.stripeOnboarded) {
      await db.sellerProfile.update({
        where: { id: user.sellerProfile.id },
        data: { stripeOnboarded: true },
      });
    }

    return NextResponse.json({
      connected: true,
      // Consider onboarded if details are submitted (charges may take time to enable)
      onboarded: status.detailsSubmitted,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      detailsSubmitted: status.detailsSubmitted,
    });
  } catch (error) {
    console.error("Error getting Stripe status:", error);
    return NextResponse.json({ connected: false });
  }
}
