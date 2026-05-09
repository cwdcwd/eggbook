import PusherClient from 'pusher-js'

// Re-export shared constants for convenience
export { CHANNELS, EVENTS } from './pusher-constants'

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
