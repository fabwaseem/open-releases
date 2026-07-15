"use client"

import { useEffect } from "react"

import { ErrorView } from "@/components/error/error-view"

export default function Error({
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
    <ErrorView digest={error.digest} onRetry={() => unstable_retry()} />
  )
}
