import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plane Autorun",
  description: "Live dashboard for plane-autorun runs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 font-sans antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
