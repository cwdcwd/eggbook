import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { syncClerkUser, deleteClerkUser } from "@/lib/clerk-user-lifecycle";

import {
  handleSubscriptionActivation,
  handleSubscriptionUpdate,
  handleSubscriptionExpiry,
} from "@/lib/subscription";

export async function POST(req: Request) {
  const headerPayload = await headers();

  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error("Please add CLERK_WEBHOOK_SECRET to .env");
  }

  // Get svix headers for verification
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error: Missing svix headers", { status: 400 });
  }

  // Get body as raw text for accurate signature verification
  const body = await req.text();

  // Verify webhook
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return new Response("Error: Verification failed", { status: 400 });
  }

  // Handle events
  const eventType = evt.type;

  if (eventType === "user.created" || eventType === "user.updated") {
    const { id, email_addresses, username, image_url } = evt.data;
    const user = await syncClerkUser({
      id,
      username,
      emailAddresses: email_addresses.map(({ email_address }) => ({ emailAddress: email_address })),
    });

    if (user && image_url) {
      const sellerProfile = await db.sellerProfile.findUnique({ where: { userId: user.id } });
      if (sellerProfile && !sellerProfile.avatarUrl) {
        await db.sellerProfile.update({ where: { id: sellerProfile.id }, data: { avatarUrl: image_url } });
      }
    }
  }

  if (eventType === "user.deleted") {
    const { id } = evt.data;
    if (id) await deleteClerkUser(id);
  }

  // Subscription events (Clerk Billing)
  // Note: Cast to unknown first since Clerk types may not include billing events
  const eventData = evt.data as unknown;

  if (eventType === "subscription.created" as string) {
    const data = eventData as {
      user_id: string;
      id: string;
      plan: { id: string; name: string; features?: { listing_limit?: number } };
      current_period_end?: number;
    };

    const expiresAt = data.current_period_end ? new Date(data.current_period_end * 1000) : undefined;
    const listingLimit = data.plan.features?.listing_limit;

    await handleSubscriptionActivation(
      data.user_id,
      data.id,
      data.plan.name || data.plan.id,
      expiresAt,
      listingLimit
    );
  }

  if (eventType === "subscription.updated" as string) {
    const data = eventData as {
      user_id: string;
      id: string;
      plan: { id: string; name: string; features?: { listing_limit?: number } };
      status: 'active' | 'canceled';
      current_period_end?: number;
    };

    const expiresAt = data.current_period_end ? new Date(data.current_period_end * 1000) : undefined;
    const listingLimit = data.plan.features?.listing_limit;

    await handleSubscriptionUpdate(
      data.user_id,
      data.id,
      data.plan.name || data.plan.id,
      data.status,
      expiresAt,
      listingLimit
    );
  }

  if (eventType === "subscription.deleted" as string) {
    const data = eventData as { user_id: string };
    await handleSubscriptionExpiry(data.user_id);
  }

  return new Response("OK", { status: 200 });
}
