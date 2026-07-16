import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Footprint — Codex activity explained clearly",
  description: "A private local view of recent Codex work, explained in normal language by Llama through Ollama.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
