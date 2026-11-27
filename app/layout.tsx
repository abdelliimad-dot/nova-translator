import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter, JetBrains_Mono } from "next/font/google";
import HtmlLocaleSync from "@/components/nova/HtmlLocaleSync";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "NOVA — AI Travel Interpreter",
  description:
    "Speak anywhere. Understand everyone. AI travel interpreter for live conversations, camera menu translation, and offline travel phrases.",
  applicationName: "NOVA",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NOVA",
  },
  icons: {
    icon: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon-192x192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#F5F3ED",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ibmPlexArabic.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#F5F3ED] text-[#242A26] selection:bg-[#DCE8DD]">
        <HtmlLocaleSync />
        {children}
      </body>
    </html>
  );
}
