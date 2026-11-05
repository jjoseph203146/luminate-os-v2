import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Luminate OS", template: "%s · Luminate OS" },
  description: "Internal operating system for Luminate Web Design & Development.",
  robots: { index: false, follow: false },
  applicationName: "Luminate OS",
  appleWebApp: { capable: true, title: "Luminate OS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1524" },
  ],
};

// Applies the owner's saved Light/Dark choice before first paint (no flash).
// Runs under the page's security-policy nonce; storage can be blocked, so it never throws.
const THEME_SCRIPT = `try{var t=localStorage.getItem("lx-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
