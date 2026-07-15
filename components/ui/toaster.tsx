"use client"

import { Toaster as HotToaster } from "react-hot-toast"

export function Toaster() {
  return (
    <HotToaster
      position="top-center"
      toastOptions={{
        className:
          "!rounded-none !bg-card !text-foreground !shadow-lg !border !border-border !text-sm",
        success: {
          iconTheme: {
            primary: "var(--primary)",
            secondary: "var(--primary-foreground)",
          },
        },
        error: {
          iconTheme: {
            primary: "var(--destructive)",
            secondary: "var(--primary-foreground)",
          },
        },
      }}
    />
  )
}
