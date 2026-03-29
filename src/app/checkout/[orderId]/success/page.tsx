import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { Button, Card } from "@/components/ui";

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
      <Card className="p-8 text-center max-w-md">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-amber-900 mb-2">
          Payment Successful!
        </h1>
        <p className="text-amber-600 mb-6">
          Your order has been paid. The seller will contact you soon to arrange pickup or delivery.
        </p>
        <div className="flex flex-col gap-3">
          <Link href="/dashboard">
            <Button className="w-full">Go to Dashboard</Button>
          </Link>
          <Link href="/messages">
            <Button variant="outline" className="w-full">
              Message Seller
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
