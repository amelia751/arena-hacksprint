import type { Metadata } from "next";
import { Geist_Mono, Libre_Franklin, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { ArenaTools } from "@/components/ArenaTools";
import "./globals.css";

const franklin = Libre_Franklin({
  variable: "--font-franklin",
  subsets: ["latin"],
});

const serif = Source_Serif_4({
  variable: "--font-cheltenham",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arena",
  description: "Describe a game. Your agent authors it. You play what it built.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${franklin.variable} ${serif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ArenaTools />
        <div className="shell">
          <nav className="site-nav">
            <Link className="wordmark" href="/">
              Arena
            </Link>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
