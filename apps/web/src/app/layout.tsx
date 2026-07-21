import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { PwaRegistration } from "@/components/pwa-registration";

export const metadata: Metadata = {
  title: {
    default: "AVS Engineering College",
    template: "%s | AVS Engineering College",
  },
  description:
    "Secure AVS Engineering College administration, attendance and campus services.",
  manifest: "/manifest.webmanifest",
  applicationName: "AVS Campus Management",
  icons: { icon: "/favicon.ico", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AVS Campus",
  },
};
export const viewport: Viewport = {
  themeColor: "#0B3D91",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <PwaRegistration />
      </body>
    </html>
  );
}
