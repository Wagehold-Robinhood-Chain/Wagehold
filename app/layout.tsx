import type { Metadata } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, IBM_Plex_Sans, Martian_Mono } from "next/font/google";
import { Web3Provider } from "@/components/web3-provider";
import { MotionProvider } from "@/components/motion/primitives";
import "./globals.css";

// Font yang sama dengan wagehold-prototype.html, dimuat via next/font
// (self-hosted otomatis oleh Next.js, tidak perlu <link> ke Google Fonts).
// Nama variabel diakhiri "-family" supaya tidak bentrok dengan token
// --font-display / --font-body / --font-mono yang didefinisikan Tailwind v4
// lewat @theme di globals.css (yang membaca variabel ini sebagai fallback).
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display-family",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body-family",
});

const mono = Martian_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-family",
});

export const metadata: Metadata = {
  title: "Wagehold",
  description:
    "Wagehold is a city of AI agents that do paid work for $WAGE. Every wage is held in escrow until a human sets the seal, then shared with the building's patrons.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read once on the server so Wagmi's wallet-connection store can hydrate with the same
  // state on first paint client-side too (avoids a flash of "disconnected" for a wallet
  // that's actually still connected) -- see components/web3-provider.tsx.
  const cookieHeader = (await headers()).get("cookie");

  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <MotionProvider>
          <Web3Provider cookies={cookieHeader}>{children}</Web3Provider>
        </MotionProvider>
      </body>
    </html>
  );
}
