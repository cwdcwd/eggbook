import * as PusherPushNotifications from "@pusher/push-notifications-web";

const isBeamsConfigured = !!process.env.NEXT_PUBLIC_BEAMS_INSTANCE_ID;

let beamsClient: PusherPushNotifications.Client | null = null;
let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    return Promise.reject(new Error("Service workers not supported"));
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => {
        swRegistrationPromise = null; // Allow retry on transient failures
        throw err;
      });
  }
  return swRegistrationPromise;
}

async function getBeamsClient(): Promise<PusherPushNotifications.Client | null> {
  if (typeof window === "undefined") return null;
  if (!isBeamsConfigured) return null;

  if (!beamsClient) {
    const registration = await getServiceWorkerRegistration();
    beamsClient = new PusherPushNotifications.Client({
      instanceId: process.env.NEXT_PUBLIC_BEAMS_INSTANCE_ID!,
      serviceWorkerRegistration: registration,
    });
  }
  return beamsClient;
}

/**
 * Start Beams and associate the device with the authenticated user.
 * Call this after the user logs in.
 */
export async function startBeams(userId: string): Promise<void> {
  try {
    const client = await getBeamsClient();
    if (!client) return;

    // Preflight: verify the auth endpoint can generate a valid token
    // before handing off to the Pusher SDK (avoids cryptic 401 from Pusher servers)
    const preflightRes = await fetch(`/api/beams/auth?user_id=${encodeURIComponent(userId)}`);
    if (!preflightRes.ok) {
      const body = await preflightRes.json().catch(() => ({}));
      console.warn(
        `[beams] Auth endpoint returned ${preflightRes.status} — skipping push registration.`,
        body.error || ""
      );
      return;
    }

    const tokenProvider = new PusherPushNotifications.TokenProvider({
      url: "/api/beams/auth",
    });

    await client.start();

    // Check if already registered to correct user
    const currentUserId = await client.getUserId();
    if (currentUserId === userId) return;

    // If registered to a different user, stop and re-register
    if (currentUserId && currentUserId !== userId) {
      await client.stop();
      await client.start();
    }

    await client.setUserId(userId, tokenProvider);
    console.log("[beams] Successfully registered for push notifications");
  } catch (err) {
    // Don't break the app if notifications fail (including SW registration failures)
    console.warn("[beams] Push notification setup failed (non-critical):", (err as Error).message || err);
  }
}

/**
 * Stop Beams and disassociate the device from the user.
 * Call this when the user logs out.
 * No-op if Beams was never initialized (avoids triggering new SW registration on cleanup).
 */
export async function stopBeams(): Promise<void> {
  if (!beamsClient) return;

  try {
    await beamsClient.stop();
    beamsClient = null;
    console.log("[beams] Stopped push notifications");
  } catch (err) {
    console.error("[beams] Failed to stop:", err);
  }
}
