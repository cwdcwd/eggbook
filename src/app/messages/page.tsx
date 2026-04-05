"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Send, ArrowLeft, User, Heart, Search, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
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

function MessagesPageContent() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get("order");
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const orderProcessedRef = useRef<string | null>(null);

  // Handle order-based conversation start
  const startConversationFromOrder = useCallback(async (orderIdParam: string) => {
    if (orderProcessedRef.current === orderIdParam) return;
    orderProcessedRef.current = orderIdParam;
    
    setIsStartingConversation(true);
    try {
      // Fetch order to get the other party's info
      const orderRes = await fetch(`/api/orders/${orderIdParam}`);
      if (!orderRes.ok) {
        console.error("Failed to fetch order");
        router.replace("/messages");
        return;
      }
      const order = await orderRes.json();
      
      // Get current user's DB ID
      const settingsRes = await fetch("/api/settings");
      if (!settingsRes.ok) {
        console.error("Failed to fetch user settings");
        router.replace("/messages");
        return;
      }
      const settings = await settingsRes.json();
      const currentUserId = settings.user.id;
      
      // Determine other party (if I'm the buyer, message the seller; if I'm the seller, message the buyer)
      const isBuyer = order.buyerId === currentUserId;
      const recipientId = isBuyer ? order.seller.userId : order.buyerId;
      
      // Send a placeholder message to create/get conversation
      // We'll use the API which finds or creates conversation based on recipientId
      const msgRes = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId,
          content: `Hi! I'm messaging about order #${orderIdParam.slice(-6)} for ${order.listing.title}.`,
        }),
      });
      
      if (msgRes.ok) {
        // Refresh conversations and select the new one
        const convoRes = await fetch("/api/messages");
        if (convoRes.ok) {
          const data = await convoRes.json();
          const convos = data.conversations || data;
          setConversations(Array.isArray(convos) ? convos : []);
          
          // Find the conversation with the recipient
          const targetConvo = convos.find((c: Conversation) => 
            c.buyerId === recipientId || c.sellerId === recipientId
          );
          if (targetConvo) {
            setSelectedConversation(targetConvo);
          }
        }
      }
      
      // Clear the order param from URL
      router.replace("/messages");
    } catch (error) {
      console.error("Error starting conversation from order:", error);
      router.replace("/messages");
    } finally {
      setIsStartingConversation(false);
    }
  }, [router]);

  // Fetch conversations
  useEffect(() => {
    async function fetchConversations() {
      try {
        const res = await fetch("/api/messages");
        if (!res.ok) {
          // User might not be synced to DB yet, or not logged in
          console.error("Failed to fetch conversations:", res.status);
          setConversations([]);
          return;
        }
        const data = await res.json();
        const convos = data.conversations || data;
        // Ensure data is an array
        setConversations(Array.isArray(convos) ? convos : []);
      } catch (error) {
        console.error("Error fetching conversations:", error);
        setConversations([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConversations();
  }, []);

  // Handle order parameter to start conversation
  useEffect(() => {
    if (orderId && !isLoading) {
      startConversationFromOrder(orderId);
    }
  }, [orderId, isLoading, startConversationFromOrder]);

  // Fetch messages when conversation is selected
  useEffect(() => {
    async function fetchMessages() {
      if (!selectedConversation) return;

      try {
        const res = await fetch(`/api/messages?conversationId=${selectedConversation.id}`);
        if (!res.ok) {
          console.error("Failed to fetch messages:", res.status);
          setMessages([]);
          return;
        }
        const data = await res.json();
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch (error) {
        console.error("Error fetching messages:", error);
        setMessages([]);
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

  if (isLoading || isStartingConversation) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center flex-col gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        {isStartingConversation && (
          <p className="text-amber-600">Starting conversation...</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Site Header */}
      <header className="bg-white border-b border-amber-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center">
                <span className="text-white text-xl">🥚</span>
              </div>
              <span className="text-xl font-bold text-amber-900">Eggbook</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/explore" className="text-amber-600 hover:text-amber-700">
                <Search className="w-6 h-6" />
              </Link>
              <Link href="/favorites" className="text-amber-600 hover:text-amber-700">
                <Heart className="w-6 h-6" />
              </Link>
              <Link href="/dashboard">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto h-[calc(100vh-64px)] flex flex-col">
        {/* Page Title / Conversation Header */}
        <div className="bg-white border-b border-amber-200 p-4 flex items-center gap-4">
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
        </div>

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
                    const isOwnMessage = message.sender?.username === user?.username;
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

export default function MessagesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    }>
      <MessagesPageContent />
    </Suspense>
  );
}
