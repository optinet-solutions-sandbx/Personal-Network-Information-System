import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import ContactsSidebar from "@/components/ContactsSidebar";
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
  title: "Networky.ai — Relationship Intelligence",
  description:
    "Capture, organize, and enrich professional relationships with AI-assisted profiles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col bg-zinc-50 text-zinc-900" suppressHydrationWarning>
        <header className="border-b border-zinc-200 bg-white">
          <div className="flex items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                N
              </span>
              <span className="text-lg font-semibold tracking-tight">
                Networky<span className="text-indigo-600">.ai</span>
              </span>
            </Link>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
              Phase 1 · MVP
            </span>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <ContactsSidebar />
          <main className="flex-1 overflow-y-auto px-6 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
