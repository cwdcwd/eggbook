"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { startBeams, stopBeams } from "@/lib/beams-client";

/**
 * Initializes Pusher Beams for the authenticated user.
 * Mount this in the root layout so push notifications work
 * regardless of which page the user is on.
 *
 * Automatically stops Beams when the user signs out (userId becomes null).
 */
export function BeamsProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const prevUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (userId) {
      startBeams(userId);
    } else if (prevUserId.current) {
      // User was signed in but is now signed out
      stopBeams();
    }
    prevUserId.current = userId;
  }, [userId]);

  return <>{children}</>;
}
