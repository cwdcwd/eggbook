"use client";

import Link from "next/link";
import { Button } from "@/components/ui";

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("Profile page error:", error);
  
  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-center p-8">
        <h1 className="text-2xl font-bold text-amber-900 mb-4">
          Something went wrong
        </h1>
        <p className="text-amber-600 mb-6">
          {error.message || "Failed to load profile page"}
        </p>
        <div className="flex gap-4 justify-center">
          <Button onClick={reset}>Try Again</Button>
          <Link href="/">
            <Button variant="outline">Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
