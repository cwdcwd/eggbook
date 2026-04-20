"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Heart, MessageSquare, Share2 } from "lucide-react";
import { Button } from "@/components/ui";

interface SellerActionButtonsProps {
  sellerProfileId: string;
  sellerUserId: string;
  sellerUsername: string;
  isFavorited?: boolean;
}

export function SellerActionButtons({
  sellerProfileId,
  sellerUserId,
  sellerUsername,
  isFavorited = false,
}: SellerActionButtonsProps) {
  const router = useRouter();
  const { userId } = useAuth();
  const [favorited, setFavorited] = useState(isFavorited);
  const [isLoading, setIsLoading] = useState(false);

  const handleMessage = async () => {
    if (!userId) {
      const returnUrl = window.location.pathname + window.location.search;
      router.push(`/sign-up?redirect_url=${encodeURIComponent(returnUrl)}`);
      return;
    }
    router.push(`/messages?recipient=${sellerUserId}`);
  };

  const handleFavorite = async () => {
    setIsLoading(true);
    try {
      if (favorited) {
        const res = await fetch(`/api/favorites?sellerProfileId=${sellerProfileId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setFavorited(false);
        }
      } else {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sellerProfileId }),
        });
        if (res.ok) {
          setFavorited(true);
        } else if (res.status === 401) {
          const returnUrl = window.location.pathname + window.location.search;
          router.push(`/sign-up?redirect_url=${encodeURIComponent(returnUrl)}`);
        }
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/@${sellerUsername}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Check out ${sellerUsername} on Eggbook`,
          url,
        });
      } catch (error) {
        // User cancelled or error
      }
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(url);
      alert("Link copied to clipboard!");
    }
  };

  return (
    <div className="flex flex-wrap justify-center sm:justify-start gap-2">
      <Button onClick={handleMessage}>
        <MessageSquare className="w-4 h-4 mr-2" />
        Message
      </Button>
      <Button
        variant="outline"
        onClick={handleFavorite}
        disabled={isLoading}
      >
        <Heart className={`w-4 h-4 mr-2 ${favorited ? "fill-current text-red-500" : ""}`} />
        {favorited ? "Favorited" : "Favorite"}
      </Button>
      <Button variant="ghost" onClick={handleShare}>
        <Share2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
