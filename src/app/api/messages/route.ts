import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { triggerNewMessage, triggerUserNewMessage } from "@/lib/pusher";
import { getOrCreateUser } from "@/lib/auth";

// Send a message
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { conversationId, content, recipientId } = body;

    const user = await getOrCreateUser(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let conversation;

    if (conversationId) {
      // Use existing conversation
      conversation = await db.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }

      // Verify user is part of conversation
      if (conversation.buyerId !== user.id && conversation.sellerId !== user.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    } else if (recipientId) {
      // Find or create conversation
      conversation = await db.conversation.findFirst({
        where: {
          OR: [
            { buyerId: user.id, sellerId: recipientId },
            { buyerId: recipientId, sellerId: user.id },
          ],
        },
      });

      if (!conversation) {
        // Determine buyer/seller roles based on user roles
        const recipient = await db.user.findUnique({
          where: { id: recipientId },
          include: { sellerProfile: true },
        });

        if (!recipient) {
          return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
        }

        // If recipient is a seller, current user is buyer
        const isBuyer = recipient.sellerProfile !== null;

        conversation = await db.conversation.create({
          data: {
            buyerId: isBuyer ? user.id : recipientId,
            sellerId: isBuyer ? recipientId : user.id,
          },
        });
      }
    } else {
      return NextResponse.json(
        { error: "conversationId or recipientId required" },
        { status: 400 }
      );
    }

    // Create message
    const message = await db.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        content,
      },
      include: {
        sender: true,
      },
    });

    // Update conversation timestamp
    await db.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    // Trigger real-time notification
    await triggerNewMessage(conversation.id, {
      id: message.id,
      content: message.content,
      senderId: message.senderId,
      createdAt: message.createdAt,
      sender: {
        id: message.sender.id,
        username: message.sender.username,
      },
    });

    // Notify the recipient about the new message (for unread badge)
    const recipientUserId = conversation.buyerId === user.id 
      ? conversation.sellerId 
      : conversation.buyerId;
    await triggerUserNewMessage(recipientUserId, {
      conversationId: conversation.id,
      senderId: user.id,
      senderUsername: user.username,
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}

// Get conversations for current user
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getOrCreateUser(userId);

    if (!user) {
      // User could not be created - return empty array
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");

    if (conversationId) {
      // Get messages for specific conversation
      const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            include: { sender: true },
          },
          buyer: true,
          seller: true,
        },
      });

      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }

      if (conversation.buyerId !== user.id && conversation.sellerId !== user.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      // Mark messages as read
      await db.message.updateMany({
        where: {
          conversationId,
          senderId: { not: user.id },
          read: false,
        },
        data: { read: true },
      });

      return NextResponse.json(conversation);
    } else {
      // Get all conversations
      const conversations = await db.conversation.findMany({
        where: {
          OR: [{ buyerId: user.id }, { sellerId: user.id }],
        },
        include: {
          buyer: true,
          seller: true,
          messages: {
            take: 1,
            orderBy: { createdAt: "desc" },
          },
          _count: {
            select: {
              messages: {
                where: {
                  senderId: { not: user.id },
                  read: false,
                },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      // Include userId for Pusher subscription
      return NextResponse.json({ conversations, userId: user.id });
    }
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
