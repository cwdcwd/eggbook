import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { triggerNewMessage, triggerUserNewMessage, triggerMessagesRead } from "@/lib/pusher";
import { notifyUser } from "@/lib/beams-server";
import { getOrCreateUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { serializeMessage } from "@/lib/message-view";
import { z } from "zod";
import { SendMessageSchema } from "@/lib/schemas";

// Get conversations for the current user, or messages for one conversation
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");

    // Get messages for a specific conversation (participants only;
    // cuid unguessability is a convenience, never the access check)
    if (conversationId) {
      const conversation = await db.conversation.findFirst({
        where: {
          id: conversationId,
          OR: [{ buyerId: user.id }, { sellerId: user.id }],
        },
        select: { id: true },
      });

      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }

      const messages = await db.message.findMany({
        where: { conversationId: conversation.id },
        include: { sender: { select: { id: true, username: true } } },
        orderBy: { createdAt: "asc" },
      });

      return NextResponse.json({ messages: messages.map(serializeMessage) });
    }

    // Get all conversations for the user with the latest message and sender names
    const conversations = await db.conversation.findMany({
      where: {
        OR: [{ buyerId: user.id }, { sellerId: user.id }],
      },
      orderBy: { updatedAt: "desc" },
      include: {
        buyer: { select: { id: true, username: true } },
        seller: { select: { id: true, username: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { sender: { select: { id: true, username: true } } },
        },
        _count: {
          select: {
            messages: {
              where: {
                read: false,
                NOT: { senderId: user.id },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      conversations: conversations.map((conv) => ({
        id: conv.id,
        buyerId: conv.buyerId,
        sellerId: conv.sellerId,
        buyer: conv.buyer,
        seller: conv.seller,
        messages: conv.messages.map(serializeMessage),
        unreadCount: conv._count.messages,
      })),
      unreadTotal: conversations.reduce((sum, conv) => sum + conv._count.messages, 0),
    });
  } catch (error) {
    const kind = error instanceof Error ? error.name : "unknown";
    console.error("Error fetching messages:", kind);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

// Send a message (creates or reuses the 1:1 conversation between the two users)
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimit(userId, "mutation");
    if (!rl.success) return rl.response;

    const user = await getOrCreateUser(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = SendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 });
    }

    const { recipientId, content, conversationId } = parsed.data;

    // If conversationId is provided, verify the user is a participant
    if (conversationId) {
      const conversation = await db.conversation.findFirst({
        where: {
          id: conversationId,
          OR: [{ buyerId: user.id }, { sellerId: user.id }],
        },
        select: { id: true },
      });

      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
    } else if (recipientId) {
      // New conversation: find existing between the two users, else create
      const existing = await db.conversation.findFirst({
        where: {
          OR: [
            { buyerId: user.id, sellerId: recipientId },
            { buyerId: recipientId, sellerId: user.id },
          ],
        },
        select: { id: true },
      });

      if (existing) {
        parsed.data.conversationId = existing.id;
      } else {
        // Recipient must exist
        const recipient = await db.user.findUnique({
          where: { id: recipientId },
          select: { id: true },
        });
        if (!recipient) {
          return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
        }

        const created = await db.conversation.create({
          data: {
            buyerId: user.id,
            sellerId: recipient.id,
          },
          select: { id: true },
        });
        parsed.data.conversationId = created.id;
      }
    } else {
      return NextResponse.json({ error: "recipientId or conversationId required" }, { status: 400 });
    }

    const conversationId2 = parsed.data.conversationId!;

    // Create the message
    const message = await db.message.create({
      data: {
        conversationId: conversationId2,
        senderId: user.id,
        content: content.trim(),
      },
      include: { sender: { select: { id: true, username: true } } },
    });

    // Serialize: strip sensitive fields before pushing to realtime/API
    const safeMessage = serializeMessage(message);

    // Realtime: conversation room (both parties) + recipient unread badge
    await triggerNewMessage(conversationId2, safeMessage);

    const recipients = await db.conversation.findUnique({
      where: { id: conversationId2 },
      select: {
        buyer: { select: { id: true, clerkId: true } },
        seller: { select: { id: true, clerkId: true } },
      },
    });
    if (recipients) {
      const other = recipients.buyer.id === user.id ? recipients.seller : recipients.buyer;
      // user channels are keyed by Clerk ID (see /api/pusherauth)
      await triggerUserNewMessage(other.clerkId, {
        conversationId: conversationId2,
        senderId: user.id,
        senderUsername: user.username,
      });

      // Push notification via Beams (runs after response is sent)
      after(async () => {
        await notifyUser(other.clerkId, {
          title: `New message from @${user.username}`,
          body: content.slice(0, 120),
          deepLink: `/messages?conversation=${conversationId2}`,
        });
      });
    }

    // Mark this message unread for the recipient (it's new)
    return NextResponse.json(safeMessage, { status: 201 });
  } catch (error) {
    const kind = error instanceof Error ? error.name : "unknown";
    console.error("Error sending message:", kind);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}

// Mark a conversation as read
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = z.object({ conversationId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const conversationId = parsed.data.conversationId;

    // Only participants may mark the conversation read
    const conversation = await db.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ buyerId: user.id }, { sellerId: user.id }],
      },
      select: {
        buyer: { select: { clerkId: true } },
        seller: { select: { clerkId: true } },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Mark all of the OTHER party's messages as read
    const updated = await db.message.updateMany({
      where: {
        conversationId,
        senderId: { not: user.id },
        read: false,
      },
      data: { read: true },
    });

    // Tell the sender their messages were read (they listen on their user
    // channel, keyed by Clerk ID — see /api/pusherauth)
    // userId from auth() is the Clerk session id.
    const otherClerkId =
      conversation.buyer.clerkId === userId
        ? conversation.seller.clerkId
        : conversation.buyer.clerkId;
    if (otherClerkId && updated.count > 0) {
      await triggerMessagesRead(otherClerkId, conversationId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const kind = error instanceof Error ? error.name : "unknown";
    console.error("Error marking messages read:", kind);
    return NextResponse.json({ error: "Failed to mark messages read" }, { status: 500 });
  }
}