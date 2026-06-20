import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "sol-edge-os Research Log",
  description: "Pre-registered search records and data provenance for sol-edge-os.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="site-title">
            sol-edge-os research log
          </Link>
          <nav className="site-nav">
            <Link href="/">searches</Link>
            <Link href="/provenance">data provenance</Link>
          </nav>
        </header>
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
