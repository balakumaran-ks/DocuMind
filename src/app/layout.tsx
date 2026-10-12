import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { siteVerificationToken } from "@/lib/env";
import "./globals.css";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateMetadata(): Metadata {
  const google = siteVerificationToken();
  return {
    title: "DocuMind",
    description: "Chat with your PDFs and get answers with page-level citations.",
    ...(google ? { verification: { google } } : {}),
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
