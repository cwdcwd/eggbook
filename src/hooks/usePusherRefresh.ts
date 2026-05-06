"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { getPusherClient, CHANNELS, EVENTS } from "@/lib/pusher";

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

  useEffect(() => {
    if (!clerkUserId) return;

    const pusher = getPusherClient();
    if (!pusher) return;

    const channels: ReturnType<typeof pusher.subscribe>[] = [];

    // Subscribe to seller channel for new orders
    if (events.includes("new-order")) {
      const sellerChannel = pusher.subscribe(CHANNELS.seller(clerkUserId));
      sellerChannel.bind(EVENTS.NEW_ORDER, debouncedRefresh);
      channels.push(sellerChannel);
    }

    // Subscribe to user channel for order updates
    if (events.includes("order-update")) {
      const userChannel = pusher.subscribe(CHANNELS.user(clerkUserId));
      userChannel.bind(EVENTS.ORDER_UPDATE, debouncedRefresh);
      channels.push(userChannel);
    }

    // Subscribe to user channel (by DB ID) for new messages
    if (events.includes("user-new-message") && dbUserId) {
      const userChannel = pusher.subscribe(CHANNELS.user(dbUserId));
      userChannel.bind(EVENTS.USER_NEW_MESSAGE, debouncedRefresh);
      channels.push(userChannel);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      channels.forEach((ch) => {
        ch.unbind_all();
        ch.unsubscribe();
      });
    };
  }, [clerkUserId, dbUserId, events, debouncedRefresh]);
}
