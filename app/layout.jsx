import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata = { title: "Studio Piano", description: "A digital piano: play chords or notes from your keyboard, in a 3D studio (V1) or a hybrid workstation (V2)." };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
