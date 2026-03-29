"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

interface RemoveFavoriteButtonProps {
  sellerProfileId: string;
}

export function RemoveFavoriteButton({ sellerProfileId }: RemoveFavoriteButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleRemove = async () => {
    if (!confirm("Remove this seller from favorites?")) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/favorites?sellerProfileId=${sellerProfileId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        router.refresh();
      } else {
        throw new Error("Failed to remove favorite");
      }
    } catch (error) {
      console.error("Failed to remove favorite:", error);
      alert("Failed to remove favorite");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleRemove}
      disabled={isLoading}
    >
      <Trash2 className="w-4 h-4 text-red-500" />
    </Button>
  );
}
