import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

// Static metadata keeps the shell render cacheable; set NEXT_PUBLIC_SITE_URL
// in production so canonical/OG URLs point at the real domain.
const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000"
).replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Contribution Garden — A living GitHub ecosystem",
    template: "%s · Contribution Garden",
  },
  description:
    "Walk through a living digital ecosystem grown from a developer’s GitHub contributions, streaks, pull requests, issues, and years of craft.",
  applicationName: "Contribution Garden",
  keywords: [
    "GitHub contributions",
    "developer portfolio",
    "3D data visualization",
    "interactive garden",
  ],
  authors: [{ name: "Contribution Garden" }],
  creator: "Contribution Garden",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "Contribution Garden",
    description: "Every line of code leaves something growing.",
    type: "website",
    siteName: "Contribution Garden",
    images: [
      {
        url: "/og-v2.png",
        width: 1200,
        height: 630,
        alt: "Contribution Garden — a living ecosystem grown from code",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contribution Garden",
    description: "Every line of code leaves something growing.",
    images: ["/og-v2.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#cdd9bd" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1511" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
