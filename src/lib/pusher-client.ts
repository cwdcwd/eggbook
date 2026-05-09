import PusherClient from 'pusher-js'

// Check if client-side Pusher is configured
const isClientPusherConfigured = !!(
  process.env.NEXT_PUBLIC_PUSHER_KEY &&
  process.env.NEXT_PUBLIC_PUSHER_CLUSTER
)

// Client-side Pusher instance (singleton)
let pusherClientInstance: PusherClient | null = null

export function getPusherClient(): PusherClient | null {
  if (typeof window === 'undefined') return null
  if (!isClientPusherConfigured) return null
  
  if (!pusherClientInstance) {
    pusherClientInstance = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY!,
      {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      }
    )
  }
  return pusherClientInstance
}

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
