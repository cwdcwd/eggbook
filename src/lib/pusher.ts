import Pusher from 'pusher'
import PusherClient from 'pusher-js'

// Server-side Pusher instance
export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
})

// Client-side Pusher instance (singleton)
let pusherClientInstance: PusherClient | null = null

export function getPusherClient() {
  if (typeof window === 'undefined') return null
  
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
}

// Trigger events
export async function triggerNewMessage(
  conversationId: string,
  message: {
    id: string
    content: string
    senderId: string
    createdAt: Date
  }
) {
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
  await pusherServer.trigger(CHANNELS.user(userId), EVENTS.ORDER_UPDATE, update)
}
