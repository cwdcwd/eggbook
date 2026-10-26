// Message view serialization shared by the messaging API (and its tests).
// Only whitelisted fields may cross the API boundary or ride a realtime
// event: full Prisma user records carry email, clerkId, and other private
// columns that must never be embedded in API responses or Pusher payloads.

export type MessageSenderView = {
  id: string;
  username: string;
};

export type MessageView = {
  id: string;
  content: string;
  senderId: string;
  createdAt: Date;
  sender?: MessageSenderView;
};

type MessageLike = {
  id: string;
  content: string;
  senderId: string;
  createdAt: Date;
  sender: MessageSenderView | null;
};

export function serializeMessage(m: MessageLike): MessageView {
  return {
    id: m.id,
    content: m.content,
    senderId: m.senderId,
    createdAt: m.createdAt,
    sender: m.sender
      ? {
          id: m.sender.id,
          username: m.sender.username,
        }
      : undefined,
  };
}
