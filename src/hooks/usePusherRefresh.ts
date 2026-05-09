"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { getPusherClient, CHANNELS, EVENTS } from "@/lib/pusher-client";

/**
 * Subscribe to Pusher events and call a refresh callback when relevant events fire.
 * Debounces rapid-fire events to avoid hammering the API.
 */
export function usePusherRefresh(
  events: ("new-order" | "order-update" | "user-new-message")[],
  onRefresh: () => void,
  { dbUserId }: { dbUserId?: string | null } = {}
) {
  const { userId: clerkUserId } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onRefresh();
    }, 500);
  }, [onRefresh]);

  // Stabilize events array so callers don't need to memoize
  const eventsKey = events.slice().sort().join(",");
  const stableEvents = useMemo(() => events, [eventsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clerkUserId) return;

    const pusher = getPusherClient();
    if (!pusher) return;

    const channelNames: string[] = [];

    // Subscribe to seller channel for new orders
    if (stableEvents.includes("new-order")) {
      const channelName = CHANNELS.seller(clerkUserId);
      const sellerChannel = pusher.subscribe(channelName);
      sellerChannel.bind(EVENTS.NEW_ORDER, debouncedRefresh);
      channelNames.push(channelName);
    }

    // Subscribe to user channel for order updates
    if (stableEvents.includes("order-update")) {
      const channelName = CHANNELS.user(clerkUserId);
      const userChannel = pusher.subscribe(channelName);
      userChannel.bind(EVENTS.ORDER_UPDATE, debouncedRefresh);
      channelNames.push(channelName);
    }

    // Subscribe to user channel (by DB ID) for new messages
    if (stableEvents.includes("user-new-message") && dbUserId) {
      const channelName = CHANNELS.user(dbUserId);
      const userChannel = pusher.subscribe(channelName);
      userChannel.bind(EVENTS.USER_NEW_MESSAGE, debouncedRefresh);
      channelNames.push(channelName);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      channelNames.forEach((name) => {
        pusher.unsubscribe(name);
      });
    };
  }, [clerkUserId, dbUserId, stableEvents, debouncedRefresh]);
}
