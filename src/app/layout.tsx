import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Eggbook - Fresh Local Eggs",
    template: "%s | Eggbook",
  },
  description: "Find and sell fresh eggs in your local area. Connect with local egg sellers or start selling your own farm-fresh eggs.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Eggbook",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "Eggbook",
    title: "Eggbook - Fresh Local Eggs",
    description: "Find and sell fresh eggs in your local area",
  },
  twitter: {
    card: "summary_large_image",
    title: "Eggbook - Fresh Local Eggs",
    description: "Find and sell fresh eggs in your local area",
  },
};

export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <head>
          <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        </head>
        <body className="min-h-full flex flex-col bg-amber-50">
          {children}
          <Script
            data-goatcounter="https://eggbook.goatcounter.com/count"
            src="//gc.zgo.at/count.js"
            strategy="afterInteractive"
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
