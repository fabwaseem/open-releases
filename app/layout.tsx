import type { Metadata } from "next"
import { DM_Sans, Geist_Mono, Space_Grotesk } from "next/font/google"
import NextTopLoader from "nextjs-toploader"

import { QueryProvider } from "@/components/providers/query-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { ScrollToTop } from "@/components/ui/scroll-to-top"
import { Toaster } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"

import "./globals.css"

const spaceGroteskHeading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
})

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: {
    default: "Releases · Open source desktop apps",
    template: "%s · Releases",
  },
  description:
    "Browse the latest Windows, macOS, and Linux downloads from open source GitHub releases.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "dark antialiased",
        fontMono.variable,
        "font-sans",
        dmSans.variable,
        spaceGroteskHeading.variable
      )}
    >
      <body>
        <ThemeProvider defaultTheme="dark" enableSystem={false}>
          <NextTopLoader
            color="var(--primary)"
            height={3}
            showSpinner={false}
            shadow="0 0 10px var(--primary)"
          />
          <QueryProvider>{children}</QueryProvider>
          <ScrollToTop />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}