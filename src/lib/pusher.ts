import Pusher from 'pusher'
import { CHANNELS, EVENTS } from './pusher-constants'

// Re-export constants for backward compatibility with server-side imports
export { CHANNELS, EVENTS } from './pusher-constants'

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

// Notify a user about an order status change.
// NOTE: userId here should be a Clerk ID (clerkId), matching the subscription
// in dashboard/layout.tsx which subscribes to CHANNELS.user(clerkUserId).
// We intentionally reuse CHANNELS.user() for both ID types because the channel
// name is opaque to Pusher — what matters is publish/subscribe consistency per
// feature (orders use clerkId, messages use dbUserId). Splitting into separate
// helpers would add indirection without preventing misuse at call sites.
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

// Notify a user about a new message (for unread badge).
// NOTE: recipientId here should be a DB user ID, matching the subscription
// in dashboard/layout.tsx which subscribes to CHANNELS.user(dbUserId).
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
