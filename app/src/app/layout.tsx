import type { Metadata } from "next";
import { Cinzel, Josefin_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
const display = Cinzel({ variable: "--font-display", subsets: ["latin"] });
const body = Josefin_Sans({ variable: "--font-body", subsets: ["latin"] });
export const metadata: Metadata = { title: "Flip Vault · MagicBlock", description: "100 boxes. Two factions. One onchain vault." };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body className={`${display.variable} ${body.variable}`}><Providers>{children}</Providers></body></html>; }
