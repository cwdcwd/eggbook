import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Egg, MapPin, MessageSquare, CreditCard, Search } from "lucide-react";

export default async function Home() {
  const { userId } = await auth();
  const isSignedIn = !!userId;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-amber-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center">
                <Egg className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-amber-900">Eggbook</span>
            </Link>
            
            <nav className="flex items-center gap-4">
              <Link 
                href="/explore" 
                className="text-amber-700 hover:text-amber-900 font-medium hidden sm:block"
              >
                Explore
              </Link>
              {!isSignedIn ? (
                <>
                  <Link 
                    href="/sign-in" 
                    className="text-amber-700 hover:text-amber-900 font-medium"
                  >
                    Sign In
                  </Link>
                  <Link 
                    href="/sign-up" 
                    className="bg-amber-500 text-white px-4 py-2 rounded-full font-medium hover:bg-amber-600 transition-colors"
                  >
                    Get Started
                  </Link>
                </>
              ) : (
                <>
                  <Link 
                    href="/dashboard" 
                    className="text-amber-700 hover:text-amber-900 font-medium"
                  >
                    Dashboard
                  </Link>
                  <UserButton />
                </>
              )}
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="bg-gradient-to-b from-amber-100 to-amber-50 py-20 sm:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl sm:text-6xl font-bold text-amber-900 mb-6">
              Fresh Local Eggs,
              <br />
              <span className="text-amber-600">Straight from the Farm</span>
            </h1>
            <p className="text-xl text-amber-700 mb-10 max-w-2xl mx-auto">
              Connect with local egg sellers in your area. Buy farm-fresh eggs or start selling your own.
            </p>
            
            {/* Search Box */}
            <div className="max-w-xl mx-auto mb-12">
              <div className="flex gap-2 bg-white rounded-full p-2 shadow-lg border border-amber-200">
                <div className="flex-1 flex items-center gap-2 px-4">
                  <MapPin className="w-5 h-5 text-amber-500" />
                  <input 
                    type="text" 
                    placeholder="Enter your location..."
                    className="flex-1 outline-none text-gray-700"
                  />
                </div>
                <button className="bg-amber-500 text-white px-6 py-3 rounded-full font-medium hover:bg-amber-600 transition-colors flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  <span className="hidden sm:inline">Find Eggs</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-4">
              <Link 
                href="/sign-up?role=buyer" 
                className="bg-amber-500 text-white px-8 py-4 rounded-full font-semibold text-lg hover:bg-amber-600 transition-colors"
              >
                Find Eggs Near Me
              </Link>
              <Link 
                href="/sign-up?role=seller" 
                className="bg-white text-amber-600 px-8 py-4 rounded-full font-semibold text-lg border-2 border-amber-500 hover:bg-amber-50 transition-colors"
              >
                Start Selling
              </Link>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-center text-amber-900 mb-12">
              Why Eggbook?
            </h2>
            
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center p-6">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MapPin className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-xl font-semibold text-amber-900 mb-2">
                  Find Local Sellers
                </h3>
                <p className="text-amber-700">
                  Discover egg sellers in your neighborhood with our map-based search. Support local farms and get the freshest eggs.
                </p>
              </div>
              
              <div className="text-center p-6">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-xl font-semibold text-amber-900 mb-2">
                  Direct Communication
                </h3>
                <p className="text-amber-700">
                  Message sellers directly to ask questions, arrange pickup times, or coordinate delivery.
                </p>
              </div>
              
              <div className="text-center p-6">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CreditCard className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-xl font-semibold text-amber-900 mb-2">
                  Secure Payments
                </h3>
                <p className="text-amber-700">
                  Pay securely online or arrange cash on pickup. Sellers get paid directly through Stripe.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-amber-500">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-white mb-6">
              Ready to Get Started?
            </h2>
            <p className="text-xl text-amber-100 mb-8">
              Join thousands of happy customers and sellers on Eggbook.
            </p>
            <Link 
              href="/sign-up" 
              className="inline-block bg-white text-amber-600 px-8 py-4 rounded-full font-semibold text-lg hover:bg-amber-50 transition-colors"
            >
              Create Your Account
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-amber-900 text-amber-100 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center">
                  <Egg className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-bold text-white">Eggbook</span>
              </div>
              <p className="text-amber-200 text-sm">
                Connecting local egg sellers with buyers since 2024.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4">For Buyers</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/explore" className="hover:text-white">Find Eggs</Link></li>
                <li><Link href="/how-it-works" className="hover:text-white">How It Works</Link></li>
                <li><Link href="/faq" className="hover:text-white">FAQ</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4">For Sellers</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/sign-up?role=seller" className="hover:text-white">Start Selling</Link></li>
                <li><Link href="/seller-guide" className="hover:text-white">Seller Guide</Link></li>
                <li><Link href="/pricing" className="hover:text-white">Pricing</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/about" className="hover:text-white">About Us</Link></li>
                <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
                <li><Link href="/privacy" className="hover:text-white">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-white">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-amber-800 mt-8 pt-8 text-center text-sm text-amber-300">
            © {new Date().getFullYear()} Eggbook. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
