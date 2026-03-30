"use client";

import { PricingTable } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft, Egg } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white">
      {/* Header */}
      <header className="border-b border-amber-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Egg className="w-8 h-8 text-amber-600" />
            <span className="text-2xl font-bold text-amber-800">Eggbook</span>
          </Link>
          <Link href="/dashboard">
            <Button variant="ghost">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-amber-900 mb-4">
            Start Selling on Eggbook
          </h1>
          <p className="text-lg text-amber-700 max-w-2xl mx-auto">
            Join our community of local egg sellers. Subscribe to unlock the ability 
            to create listings and connect with buyers in your area.
          </p>
        </div>

        {/* Clerk Pricing Table */}
        <div className="bg-white rounded-2xl shadow-lg p-8 border border-amber-100">
          <PricingTable />
        </div>

        {/* FAQ Section */}
        <div className="mt-12 space-y-6">
          <h2 className="text-2xl font-bold text-amber-900 text-center">
            Frequently Asked Questions
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-6 border border-amber-100">
              <h3 className="font-semibold text-amber-900 mb-2">
                What&apos;s included in the subscription?
              </h3>
              <p className="text-amber-700 text-sm">
                Your subscription gives you unlimited egg listings, access to buyer 
                messages, order management tools, and analytics to grow your business.
              </p>
            </div>
            
            <div className="bg-white rounded-lg p-6 border border-amber-100">
              <h3 className="font-semibold text-amber-900 mb-2">
                Can I cancel anytime?
              </h3>
              <p className="text-amber-700 text-sm">
                Yes! You can cancel your subscription at any time. Your listings will 
                remain active until the end of your billing period.
              </p>
            </div>
            
            <div className="bg-white rounded-lg p-6 border border-amber-100">
              <h3 className="font-semibold text-amber-900 mb-2">
                How do payments work?
              </h3>
              <p className="text-amber-700 text-sm">
                You can choose to let Eggbook handle payments (we take a small commission) 
                or connect your own Stripe account for direct deposits.
              </p>
            </div>
            
            <div className="bg-white rounded-lg p-6 border border-amber-100">
              <h3 className="font-semibold text-amber-900 mb-2">
                Do I need a business license?
              </h3>
              <p className="text-amber-700 text-sm">
                Requirements vary by location. We recommend checking your local cottage 
                food laws regarding egg sales in your area.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
