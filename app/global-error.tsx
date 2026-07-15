"use client"

import { useEffect } from "react"
import { DM_Sans, Space_Grotesk } from "next/font/google"

import { ErrorView } from "@/components/error/error-view"
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

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html
      lang="en"
      className={cn(
        "dark antialiased",
        "font-sans",
        dmSans.variable,
        spaceGroteskHeading.variable
      )}
    >
      <body>
        <ErrorView digest={error.digest} onRetry={() => unstable_retry()} />
      </body>
    </html>
  )
}
