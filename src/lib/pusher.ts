import Pusher from 'pusher'
import PusherClient from 'pusher-js'

// Check if Pusher is configured
const isPusherConfigured = !!(
  process.env.PUSHER_APP_ID &&
  process.env.PUSHER_KEY &&
  process.env.PUSHER_SECRET &&
  process.env.PUSHER_CLUSTER
)

// Server-side Pusher instance (only if configured)
export const pusherServer = isPusherConfigured
  ? new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    })
  : null

// Check if client-side Pusher is configured
const isClientPusherConfigured = !!(  process.env.NEXT_PUBLIC_PUSHER_KEY &&
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

// Trigger events
export async function triggerNewMessage(
  conversationId: string,
  message: {
    id: string
    content: string
    senderId: string
    createdAt: Date
    sender?: {
      id: string
      username: string
    }
  }
) {
  if (!pusherServer) return
  await pusherServer.trigger(
    CHANNELS.conversation(conversationId),
    EVENTS.NEW_MESSAGE,
    message
  )
}

export async function triggerNewOrder(
  sellerId: string,
  order: {
    id: string
    buyerName: string
    listingTitle: string
    quantity: number
    totalPrice: number
  }
) {
  if (!pusherServer) return
  await pusherServer.trigger(CHANNELS.seller(sellerId), EVENTS.NEW_ORDER, order)
}

export async function triggerOrderUpdate(
  userId: string,
  update: {
    orderId: string
    status: string
    message?: string
  }
) {
  if (!pusherServer) return
  await pusherServer.trigger(CHANNELS.user(userId), EVENTS.ORDER_UPDATE, update)
}

// Notify a user about a new message (for unread badge)
export async function triggerUserNewMessage(
  recipientId: string,
  message: {
    conversationId: string
    senderId: string
    senderUsername: string
  }
) {
  if (!pusherServer) return
  await pusherServer.trigger(
    CHANNELS.user(recipientId),
    EVENTS.USER_NEW_MESSAGE,
    message
  )
}

// Notify the sender that their messages have been read
export async function triggerMessagesRead(
  senderId: string,
  conversationId: string
) {
  if (!pusherServer) return
  await pusherServer.trigger(
    CHANNELS.user(senderId),
    EVENTS.MESSAGES_READ,
    { conversationId }
  )
}
