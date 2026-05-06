import PushNotifications from "@pusher/push-notifications-server";
import * as jwt from "jsonwebtoken";

const HEX_REGEX = /^[0-9a-fA-F]+$/;

const isBeamsConfigured = !!(
  process.env.NEXT_PUBLIC_BEAMS_INSTANCE_ID &&
  process.env.BEAMS_SECRET_KEY
);

let beamsServerInstance: PushNotifications | null = null;

function getBeamsServer(): PushNotifications | null {
  if (!isBeamsConfigured) return null;

  if (!beamsServerInstance) {
    beamsServerInstance = new PushNotifications({
      instanceId: process.env.NEXT_PUBLIC_BEAMS_INSTANCE_ID!,
      secretKey: process.env.BEAMS_SECRET_KEY!,
    });
  }
  return beamsServerInstance;
}

/**
 * Sanitize a deep link to prevent open-redirect attacks.
 * Beams requires deep_link to be a full URI. We only allow relative paths
 * starting with "/" and prepend the app URL. Returns undefined if no valid
 * link can be constructed.
 */
function sanitizeDeepLink(deepLink: string | undefined): string | undefined {
  if (!deepLink) return undefined;
  if (!deepLink.startsWith("/") || deepLink.startsWith("//")) return undefined;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return undefined;
  return `${baseUrl}${deepLink}`;
}

/**
 * Generate a Beams token for authenticating a user's device.
 * Uses hex-decoded secret key for correct JWT signature.
 */
export function generateBeamsToken(userId: string) {
  if (!isBeamsConfigured) return null;

  const instanceId = process.env.NEXT_PUBLIC_BEAMS_INSTANCE_ID!;
  const rawKey = process.env.BEAMS_SECRET_KEY!;

  if (!HEX_REGEX.test(rawKey)) {
    console.error("[beams-server] BEAMS_SECRET_KEY is not valid hex");
    return null;
  }

  const secretKey = Buffer.from(rawKey, "hex");

  const token = jwt.sign({}, secretKey, {
    algorithm: "HS256",
    expiresIn: "24h",
    issuer: `https://${instanceId}.pushnotifications.pusher.com`,
    subject: userId,
  });

  return { token };
}

/**
 * Send a push notification to a specific user.
 * No-op if Beams is not configured. Non-blocking (fire-and-forget).
 */
export function notifyUser(
  userId: string,
  notification: { title: string; body: string; deepLink?: string }
): void {
  const beams = getBeamsServer();
  if (!beams) return;

  beams.publishToUsers([userId], {
    web: {
      notification: {
        title: notification.title,
        body: notification.body,
        deep_link: sanitizeDeepLink(notification.deepLink),
      },
    },
  }).catch((err) => {
    console.error("[beams-server] Failed to notify user", err);
  });
}

/**
 * Send a push notification to multiple users.
 * No-op if Beams is not configured. Non-blocking (fire-and-forget).
 */
export function notifyUsers(
  userIds: string[],
  notification: { title: string; body: string; deepLink?: string }
): void {
  const beams = getBeamsServer();
  if (!beams || userIds.length === 0) return;

  beams.publishToUsers(userIds, {
    web: {
      notification: {
        title: notification.title,
        body: notification.body,
        deep_link: sanitizeDeepLink(notification.deepLink),
      },
    },
  }).catch((err) => {
    console.error("[beams-server] Failed to notify users (count:", userIds.length, ")", err);
  });
}
