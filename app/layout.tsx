import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import AppShell from "@/components/AppShell";
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
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme init: runs synchronously before first paint so the
            page renders in the correct theme. Mirrors the key/logic used by
            ThemeToggle. Guarded so storage being unavailable can't break boot.
            next/script with beforeInteractive inlines this into the server HTML
            <head> and runs it before hydration (raw <script> tags rendered by
            React components are not executed on the client). */}
        <Script id="networky-theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('networky:theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t!=='light'&&m)){document.documentElement.classList.add('dark');}}catch(e){}})();`}
        </Script>
      </head>
      <body
        className="flex h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
        suppressHydrationWarning
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
