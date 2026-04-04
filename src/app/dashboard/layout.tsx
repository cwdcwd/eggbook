"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
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

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Orders", href: "/dashboard/orders", icon: ShoppingCart },
  { name: "Messages", href: "/messages", icon: MessageSquare },
  { name: "Listings", href: "/dashboard/listings", icon: Package },
  { name: "Favorites", href: "/favorites", icon: Heart },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  // Initialize from localStorage (default to false if not set)
  const getInitialCollapsed = () => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  };
  
  const [isCollapsed, setIsCollapsed] = useState(getInitialCollapsed);

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

                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      title={isCollapsed ? item.name : undefined}
                      className={cn(
                        "group flex items-center text-sm font-medium rounded-lg transition-colors",
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

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center px-3 py-1",
                    isActive ? "text-amber-600" : "text-amber-400"
                  )}
                >
                  <item.icon className="h-6 w-6" />
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
