"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Send, ArrowLeft, User } from "lucide-react";
import { Button, Input, Card } from "@/components/ui";
import { formatRelativeTime } from "@/lib/utils";
import { getPusherClient, CHANNELS, EVENTS } from "@/lib/pusher";

interface Message {
  id: string;
  content: string;
  senderId: string;
  createdAt: Date;
  sender: {
    id: string;
    username: string;
  };
}

interface Conversation {
  id: string;
  buyerId: string;
  sellerId: string;
  buyer: { id: string; username: string };
  seller: { id: string; username: string };
  messages: Message[];
  _count?: { messages: number };
}

export default function MessagesPage() {
  const { user } = useUser();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  useEffect(() => {
    async function fetchConversations() {
      try {
        const res = await fetch("/api/messages");
        const data = await res.json();
        setConversations(data);
      } catch (error) {
        console.error("Error fetching conversations:", error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConversations();
  }, []);

  // Fetch messages when conversation is selected
  useEffect(() => {
    async function fetchMessages() {
      if (!selectedConversation) return;

      try {
        const res = await fetch(`/api/messages?conversationId=${selectedConversation.id}`);
        const data = await res.json();
        setMessages(data.messages || []);
      } catch (error) {
        console.error("Error fetching messages:", error);
      }
    }

    fetchMessages();
  }, [selectedConversation]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!selectedConversation) return;

    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = pusher.subscribe(CHANNELS.conversation(selectedConversation.id));

    channel.bind(EVENTS.NEW_MESSAGE, (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
    };
  }, [selectedConversation]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConversation) return;

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          content: newMessage,
        }),
      });

      if (res.ok) {
        setNewMessage("");
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const getOtherUser = (conv: Conversation) => {
    if (!user) return conv.buyer;
    // This is simplified - in reality you'd compare with actual user ID
    return conv.buyer.username === user.username ? conv.seller : conv.buyer;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-amber-50">
      <div className="max-w-4xl mx-auto h-screen flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-amber-200 p-4 flex items-center gap-4">
          {selectedConversation ? (
            <>
              <button
                onClick={() => setSelectedConversation(null)}
                className="md:hidden"
              >
                <ArrowLeft className="w-6 h-6 text-amber-600" />
              </button>
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h1 className="font-semibold text-amber-900">
                  @{getOtherUser(selectedConversation).username}
                </h1>
              </div>
            </>
          ) : (
            <h1 className="text-xl font-bold text-amber-900">Messages</h1>
          )}
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Conversation List */}
          <div
            className={`w-full md:w-80 border-r border-amber-200 bg-white overflow-y-auto ${
              selectedConversation ? "hidden md:block" : ""
            }`}
          >
            {conversations.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-amber-600">No conversations yet</p>
                <p className="text-sm text-amber-500 mt-2">
                  Start a conversation by messaging a seller
                </p>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`w-full p-4 flex items-start gap-3 hover:bg-amber-50 border-b border-amber-100 text-left ${
                    selectedConversation?.id === conv.id ? "bg-amber-50" : ""
                  }`}
                >
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <p className="font-medium text-amber-900 truncate">
                        @{getOtherUser(conv).username}
                      </p>
                      {conv._count && conv._count.messages > 0 && (
                        <span className="bg-amber-500 text-white text-xs rounded-full px-2 py-0.5">
                          {conv._count.messages}
                        </span>
                      )}
                    </div>
                    {conv.messages?.[0] && (
                      <p className="text-sm text-amber-600 truncate">
                        {conv.messages[0].content}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Message Thread */}
          <div
            className={`flex-1 flex flex-col bg-amber-50 ${
              !selectedConversation ? "hidden md:flex" : ""
            }`}
          >
            {selectedConversation ? (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map((message) => {
                    const isOwnMessage = message.sender.username === user?.username;
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                            isOwnMessage
                              ? "bg-amber-500 text-white"
                              : "bg-white text-amber-900"
                          }`}
                        >
                          <p>{message.content}</p>
                          <p
                            className={`text-xs mt-1 ${
                              isOwnMessage ? "text-amber-100" : "text-amber-500"
                            }`}
                          >
                            {formatRelativeTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <form
                  onSubmit={sendMessage}
                  className="p-4 bg-white border-t border-amber-200"
                >
                  <div className="flex gap-2">
                    <Input
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1"
                    />
                    <Button type="submit" disabled={!newMessage.trim()}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-amber-600">Select a conversation to start messaging</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
