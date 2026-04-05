"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth } from "@clerk/nextjs";
import {
  Egg,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Settings,
  MessageSquare,
  Heart,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPusherClient, CHANNELS, EVENTS } from "@/lib/pusher";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Orders", href: "/dashboard/orders", icon: ShoppingCart },
  { name: "Messages", href: "/dashboard/messages", icon: MessageSquare },
  { name: "Listings", href: "/dashboard/listings", icon: Package },
  { name: "Favorites", href: "/dashboard/favorites", icon: Heart },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { userId: clerkUserId } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const lastPathRef = useRef(pathname);
  
  // Initialize from localStorage (default to false if not set)
  const getInitialCollapsed = () => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  };
  
  const [isCollapsed, setIsCollapsed] = useState(getInitialCollapsed);

  // Fetch unread message count and user ID
  useEffect(() => {
    let cancelled = false;
    
    async function fetchData() {
      try {
        const res = await fetch("/api/messages");
        if (res.ok && !cancelled) {
          const data = await res.json();
          // API returns { conversations: [...], userId: string }
          if (data.userId) {
            setDbUserId(data.userId);
          }
          if (Array.isArray(data.conversations)) {
            const total = data.conversations.reduce((sum: number, conv: { _count?: { messages?: number } }) => {
              return sum + (conv._count?.messages || 0);
            }, 0);
            setUnreadCount(total);
          } else if (Array.isArray(data)) {
            // Fallback for old response format
            const total = data.reduce((sum: number, conv: { _count?: { messages?: number } }) => {
              return sum + (conv._count?.messages || 0);
            }, 0);
            setUnreadCount(total);
          }
        }
      } catch (error) {
        console.error("Failed to fetch unread count:", error);
      }
    }
    
    fetchData();
    
    return () => { cancelled = true; };
  }, []);

  // Fetch pending orders count for sellers
  useEffect(() => {
    let cancelled = false;
    
    async function fetchPendingOrders() {
      try {
        const res = await fetch("/api/orders?role=seller&status=PENDING");
        if (res.ok && !cancelled) {
          const orders = await res.json();
          setPendingOrdersCount(Array.isArray(orders) ? orders.length : 0);
        }
      } catch (error) {
        console.error("Failed to fetch pending orders:", error);
      }
    }
    
    fetchPendingOrders();
    
    return () => { cancelled = true; };
  }, []);

  // Subscribe to Pusher for real-time unread updates
  useEffect(() => {
    if (!dbUserId) return;

    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = pusher.subscribe(CHANNELS.user(dbUserId));
    
    channel.bind(EVENTS.USER_NEW_MESSAGE, () => {
      // Increment unread count when a new message arrives
      // Only if we're not on the messages page
      if (!pathname.includes("/messages")) {
        setUnreadCount(prev => prev + 1);
      }
    });

    channel.bind(EVENTS.MESSAGES_READ, () => {
      // Refetch unread count when recipient reads our messages
      fetch("/api/messages")
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.conversations) {
            const total = data.conversations.reduce((sum: number, conv: { _count?: { messages?: number } }) => {
              return sum + (conv._count?.messages || 0);
            }, 0);
            setUnreadCount(total);
          }
        })
        .catch(() => {});
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(CHANNELS.user(dbUserId));
    };
  }, [dbUserId, pathname]);

  // Subscribe to Pusher for order updates (new orders and status changes)
  useEffect(() => {
    if (!clerkUserId) return;

    const pusher = getPusherClient();
    if (!pusher) return;

    // Subscribe to seller channel for new orders
    const sellerChannel = pusher.subscribe(CHANNELS.seller(clerkUserId));
    sellerChannel.bind(EVENTS.NEW_ORDER, () => {
      // Increment pending orders when a new order arrives
      if (!pathname.includes("/orders")) {
        setPendingOrdersCount(prev => prev + 1);
      } else {
        // Refetch if we're on the orders page
        fetch("/api/orders?role=seller&status=PENDING")
          .then(res => res.ok ? res.json() : [])
          .then(orders => setPendingOrdersCount(Array.isArray(orders) ? orders.length : 0))
          .catch(() => {});
      }
    });

    // Subscribe to user channel for order status updates
    const userChannel = pusher.subscribe(CHANNELS.user(clerkUserId));
    userChannel.bind(EVENTS.ORDER_UPDATE, () => {
      // Refetch pending orders when status changes
      fetch("/api/orders?role=seller&status=PENDING")
        .then(res => res.ok ? res.json() : [])
        .then(orders => setPendingOrdersCount(Array.isArray(orders) ? orders.length : 0))
        .catch(() => {});
    });

    return () => {
      sellerChannel.unbind_all();
      userChannel.unbind(EVENTS.ORDER_UPDATE);
      pusher.unsubscribe(CHANNELS.seller(clerkUserId));
      // Don't unsubscribe from user channel here as it's also used for messages
    };
  }, [clerkUserId, pathname]);

  // Reset unread count when navigating to messages page
  useEffect(() => {
    // Only refetch when navigating TO messages page (not initial load)
    if (pathname.includes("/messages") && !lastPathRef.current.includes("/messages")) {
      let cancelled = false;
      
      async function refetch() {
        try {
          const res = await fetch("/api/messages");
          if (res.ok && !cancelled) {
            const data = await res.json();
            if (Array.isArray(data.conversations)) {
              const total = data.conversations.reduce((sum: number, conv: { _count?: { messages?: number } }) => {
                return sum + (conv._count?.messages || 0);
              }, 0);
              setUnreadCount(total);
            }
          }
        } catch (error) {
          console.error("Failed to refetch unread count:", error);
        }
      }
      
      refetch();
      return () => { cancelled = true; };
    }
    
    lastPathRef.current = pathname;
  }, [pathname]);

  // Reset pending orders when navigating to orders page
  useEffect(() => {
    if (pathname.includes("/orders") && !lastPathRef.current.includes("/orders")) {
      // Refetch pending orders when visiting orders page
      fetch("/api/orders?role=seller&status=PENDING")
        .then(res => res.ok ? res.json() : [])
        .then(orders => setPendingOrdersCount(Array.isArray(orders) ? orders.length : 0))
        .catch(() => {});
    }
  }, [pathname]);

  // Save collapsed state to localStorage
  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("sidebar-collapsed", String(newState));
  };

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Top Header */}
      <header className="bg-white border-b border-amber-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center">
                <Egg className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-amber-900">Eggbook</span>
            </Link>

            <div className="flex items-center gap-4">
              <UserButton />
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside 
          className={cn(
            "hidden md:flex md:flex-col md:fixed md:inset-y-0 md:pt-16 transition-all duration-300",
            isCollapsed ? "md:w-16" : "md:w-64"
          )}
        >
          <div className="flex-1 flex flex-col min-h-0 bg-white border-r border-amber-200 relative">
            {/* Collapse toggle button */}
            <button
              onClick={toggleCollapsed}
              className="absolute -right-3 top-8 w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center text-white shadow-md hover:bg-amber-600 transition-colors z-10"
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>

            <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
              <nav className={cn("mt-5 flex-1 space-y-1", isCollapsed ? "px-1" : "px-2")}>
                {navigation.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/dashboard" &&
                      pathname.startsWith(item.href));
                  const showMessageBadge = item.name === "Messages" && unreadCount > 0;
                  const showOrderBadge = item.name === "Orders" && pendingOrdersCount > 0;
                  const badgeCount = item.name === "Messages" ? unreadCount : pendingOrdersCount;

                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      title={isCollapsed ? item.name : undefined}
                      className={cn(
                        "group flex items-center text-sm font-medium rounded-lg transition-colors relative",
                        isCollapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                        isActive
                          ? "bg-amber-100 text-amber-900"
                          : "text-amber-700 hover:bg-amber-50 hover:text-amber-900"
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-5 w-5 flex-shrink-0",
                          !isCollapsed && "mr-3",
                          isActive
                            ? "text-amber-600"
                            : "text-amber-400 group-hover:text-amber-600"
                        )}
                      />
                      {!isCollapsed && item.name}
                      {(showMessageBadge || showOrderBadge) && (
                        <span className={cn(
                          "bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center",
                          isCollapsed 
                            ? "absolute -top-1 -right-1 w-4 h-4 text-[10px]" 
                            : "ml-auto min-w-[20px] h-5 px-1.5"
                        )}>
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </aside>

        {/* Mobile bottom navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-amber-200 z-50">
          <div className="flex justify-around py-2">
            {navigation.slice(0, 5).map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              const showMessageBadge = item.name === "Messages" && unreadCount > 0;
              const showOrderBadge = item.name === "Orders" && pendingOrdersCount > 0;
              const badgeCount = item.name === "Messages" ? unreadCount : pendingOrdersCount;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center px-3 py-1 relative",
                    isActive ? "text-amber-600" : "text-amber-400"
                  )}
                >
                  <div className="relative">
                    <item.icon className="h-6 w-6" />
                    {(showMessageBadge || showOrderBadge) && (
                      <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </div>
                  <span className="text-xs mt-1">{item.name}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Main content */}
        <main 
          className={cn(
            "flex flex-col flex-1 pb-20 md:pb-0 transition-all duration-300",
            isCollapsed ? "md:pl-16" : "md:pl-64"
          )}
        >
          <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
