import Link from "next/link";
import { Button } from "@/components/ui";

export default function SellerNotFound() {
  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-center p-8">
        <div className="text-6xl mb-4">🥚</div>
        <h1 className="text-2xl font-bold text-amber-900 mb-4">
          Seller Not Found
        </h1>
        <p className="text-amber-600 mb-6">
          This seller profile doesn&apos;t exist or is no longer available.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/explore">
            <Button>Find Sellers</Button>
          </Link>
          <Link href="/">
            <Button variant="outline">Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
