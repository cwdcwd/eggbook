import PushNotifications from "@pusher/push-notifications-server";

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
 * starting with "/" and prepend the app URL. Verifies the constructed URL's
 * origin matches the app URL to prevent protocol-relative or encoding bypasses.
 */
function sanitizeDeepLink(deepLink: string | undefined): string | undefined {
  if (!deepLink) return undefined;
  if (!deepLink.startsWith("/") || deepLink.startsWith("//")) return undefined;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return undefined;

  const fullUrl = `${baseUrl}${deepLink}`;

  // Parse and verify origin matches to prevent encoding bypasses
  try {
    const parsed = new URL(fullUrl);
    const expected = new URL(baseUrl);
    if (parsed.origin !== expected.origin) return undefined;
  } catch {
    return undefined;
  }

  return fullUrl;
}

/**
 * Generate a Beams token for authenticating a user's device.
 * Uses the official SDK's generateToken method for correct signature.
 * Returns { token } on success, or { error, code } on failure.
 */
export function generateBeamsToken(userId: string):
  | { token: string }
  | { error: string; code: "NOT_CONFIGURED" | "INVALID_KEY" }
{
  const beams = getBeamsServer();
  if (!beams) {
    return { error: "Beams is not configured", code: "NOT_CONFIGURED" };
  }

  const beamsToken = beams.generateToken(userId);
  return { token: beamsToken.token };
}

/**
 * Send a push notification to a specific user.
 * No-op if Beams is not configured. Failures are logged but do not throw.
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
          deep_link: sanitizeDeepLink(notification.deepLink),
        },
      },
    });
  } catch (err) {
    console.error("[beams-server] Failed to notify user", err);
  }
}

/**
 * Send a push notification to multiple users.
 * No-op if Beams is not configured. Failures are logged but do not throw.
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
          deep_link: sanitizeDeepLink(notification.deepLink),
        },
      },
    });
  } catch (err) {
    console.error("[beams-server] Failed to notify users (count:", userIds.length, ")", err);
  }
}
