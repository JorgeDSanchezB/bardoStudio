import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bardo Studio — Musicalización auditable de narraciones",
  description:
    "Acompaña sesiones de D&D y audiolibros de 3+ horas con música adaptada a la tensión de la historia. Pipeline por fases con aprobación visual: análisis de silencios, transcripción Whisper local, música CC0, ducking y editor tipo Camtasia.",
  keywords: [
    "D&D",
    "audiolibros",
    "musicalización",
    "automatización",
    "DAW",
    "Whisper",
  ],
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
