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
// NOTE: userId here must be a Clerk ID (clerkId): user channels are keyed by
// Clerk ID and authorized by /api/pusherauth (private-user-<clerkId> may only
// be subscribed by the owner of that Clerk account).
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
// NOTE: recipientId must be the recipient's Clerk ID (clerkId), matching the
// subscription in dashboard/layout.tsx and the /api/pusherauth allow-list.
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

// Decide whether the authenticated caller may subscribe to a requested Pusher
// channel. Centralized so the channel-auth endpoint and its tests share one
// allow-list. Rules:
//   private-user-<clerkId>                → only the owner of that clerkId
//   private-seller-<clerkId>              → only that seller (the user themself)
//   private-conversation-<conversationId> → only participants of the conversation
// Unknown namespaces / public channels (no private- prefix) → always denied.
export function isChannelAuthAllowed(
  channel: string,
  ctx: { clerkId: string; dbUserId: string; conversationIds: Set<string> }
): boolean {
  if (!channel.startsWith('private-')) return false
  const resource = channel.slice('private-'.length)
  if (resource.startsWith('user-')) {
    return resource.length > 'user-'.length && resource.slice('user-'.length) === ctx.clerkId
  }
  if (resource.startsWith('seller-')) {
    return resource.length > 'seller-'.length && resource.slice('seller-'.length) === ctx.clerkId
  }
  if (resource.startsWith('conversation-')) {
    const id = resource.slice('conversation-'.length)
    return id.length > 0 && ctx.conversationIds.has(id)
  }
  return false
}
