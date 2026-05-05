import PushNotifications from "@pusher/push-notifications-server";
import * as jwt from "jsonwebtoken";

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
 * Generate a Beams token for authenticating a user's device.
 * Uses hex-decoded secret key for correct JWT signature.
 */
export function generateBeamsToken(userId: string) {
  if (!isBeamsConfigured) return null;

  const instanceId = process.env.NEXT_PUBLIC_BEAMS_INSTANCE_ID!;
  const secretKey = Buffer.from(process.env.BEAMS_SECRET_KEY!, "hex");

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
 * No-op if Beams is not configured.
 */
export async function notifyUser(
  userId: string,
  notification: { title: string; body: string; deepLink?: string }
): Promise<void> {
  const beams = getBeamsServer();
  if (!beams) return;

  try {
    await beams.publishToUsers([userId], {
      web: {
        notification: {
          title: notification.title,
          body: notification.body,
          deep_link: notification.deepLink || undefined,
        },
      },
    });
  } catch (err) {
    // Don't let notification failures break the main flow
    console.error("[beams-server] Failed to notify user:", userId, err);
  }
}

/**
 * Send a push notification to multiple users.
 * No-op if Beams is not configured.
 */
export async function notifyUsers(
  userIds: string[],
  notification: { title: string; body: string; deepLink?: string }
): Promise<void> {
  const beams = getBeamsServer();
  if (!beams || userIds.length === 0) return;

  try {
    await beams.publishToUsers(userIds, {
      web: {
        notification: {
          title: notification.title,
          body: notification.body,
          deep_link: notification.deepLink || undefined,
        },
      },
    });
  } catch (err) {
    console.error("[beams-server] Failed to notify users:", userIds, err);
  }
}
