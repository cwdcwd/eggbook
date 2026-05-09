// Shared Pusher constants — no runtime dependencies.
// Safe to import from both server and client code.

// Channel naming conventions
export const CHANNELS = {
  conversation: (id: string) => `conversation-${id}`,
  user: (id: string) => `user-${id}`,
  seller: (id: string) => `seller-${id}`,
}

// Event types
export const EVENTS = {
  NEW_MESSAGE: 'new-message',
  NEW_ORDER: 'new-order',
  ORDER_UPDATE: 'order-update',
  TYPING: 'typing',
  USER_NEW_MESSAGE: 'user-new-message',
  MESSAGES_READ: 'messages-read',
}
