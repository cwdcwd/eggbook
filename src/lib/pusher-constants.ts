// Shared Pusher constants — no runtime dependencies.
// Safe to import from both server and client code.

// `private-` prefix types: any channel these helpers produce is guarded by the
// Pusher channel-auth endpoint (src/app/api/pusherauth/route.ts), which
// authorizes the signed-in Clerk user against the exact channel name.
export type PrivateChannel = `private-${string}`;

// Channel naming conventions. USER, SELLER, and CONVERSATION channels are all
// PRIVATE, and each carries per-user payloads (message previews, order data) so
// all subscriptions must go through channel auth. Never subscribe client-side
// without auth, and never emit per-user events on a public channel.
export const CHANNELS = {
  user: (id: string): PrivateChannel => `private-user-${id}`,
  seller: (id: string): PrivateChannel => `private-seller-${id}`,
  conversation: (id: string): PrivateChannel => `private-conversation-${id}`,
} as const;

// Event types
export const EVENTS = {
  NEW_MESSAGE: 'new-message',
  NEW_ORDER: 'new-order',
  ORDER_UPDATE: 'order-update',
  TYPING: 'typing',
  USER_NEW_MESSAGE: 'user-new-message',
  MESSAGES_READ: 'messages-read',
} as const;
