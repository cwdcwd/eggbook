import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { isChannelAuthAllowed, pusherServer } from "@/lib/pusher";
import { rateLimit } from "@/lib/rate-limit";

// Pusher Channels channel authorization for private-* channels.
//
// The Pusher client cannot subscribe to a private channel until this endpoint
// signs its subscription request. We authorize only channels that belong to
// the authenticated user:
//   private-user-<clerkId>                     — that user's notifications
//   private-seller-<clerkId>                   — the user as a seller
//   private-conversation-<conversationId>      — only conversations they are a
//                                                participant of (cuids are also
//                                                unguessable, but membership
//                                                is always verified server-side)
// Everything else (including unknown channel families) is refused with 403, so
// this endpoint cannot be used to mint signatures for unrelated channels.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const rl = await rateLimit(userId, "read");
    if (!rl.success) return rl.response;

    if (!pusherServer) {
      // Realtime not configured; client falls back to polling. Never 200 here —
      // an unsigned subscription must fail closed.
      return new NextResponse("Not configured", { status: 503 });
    }

    // Pusher's protocol delivers the subscription request as form data.
    const form = await req.formData();
    const channel = form.get("channel_name");
    const socketId = form.get("socket_id");

    if (typeof channel !== "string" || channel.length === 0 || channel.length > 200) {
      return new NextResponse("Bad request", { status: 400 });
    }
    if (typeof socketId !== "string" || socketId.length === 0 || socketId.length > 100) {
      return new NextResponse("Bad request", { status: 400 });
    }

    const dbUser = await db.user.findUnique({
      where: { clerkId: userId },
      select: {
        id: true,
        conversations1: { select: { id: true } },
        conversations2: { select: { id: true } },
      },
    });
    if (!dbUser) {
      return new NextResponse("User not found", { status: 404 });
    }

    const conversationIds = new Set<string>([
      ...dbUser.conversations1.map((c) => c.id),
      ...dbUser.conversations2.map((c) => c.id),
    ]);

    if (!isChannelAuthAllowed(channel, { clerkId: userId, dbUserId: dbUser.id, conversationIds })) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // pusher.authorizeChannel returns { auth: "key:hmacSignature" } bound to
    // exactly this (socketId, channel) pair.
    const authResponse = pusherServer.authorizeChannel(socketId, channel);

    return new NextResponse(JSON.stringify(authResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // The signature is bound to one socket_id: never cache or share it.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // Log the failure kind only — request bodies/socket ids are per-socket
    // ephemeral and never useful here.
    const kind = error instanceof Error ? error.name : "unknown";
    console.error("Channel auth failed:", kind);
    return new NextResponse("Channel auth failed", { status: 500 });
  }
}