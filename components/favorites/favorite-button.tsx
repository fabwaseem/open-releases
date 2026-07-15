"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HeartIcon } from "@phosphor-icons/react"
import toast from "react-hot-toast"

import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

async function fetchFavoriteIds(): Promise<string[]> {
  const res = await fetch("/api/favorites")
  if (res.status === 401) return []
  if (!res.ok) throw new Error("Failed to load favorites")
  const data = (await res.json()) as { ids: string[] }
  return data.ids
}

export function FavoriteButton({
  repositoryId,
  fullName,
  className,
  size = "default",
  tone = "default",
}: {
  repositoryId?: string
  fullName: string
  className?: string
  size?: "default" | "sm" | "icon"
  /** Quieter style for dense layouts like cards. */
  tone?: "default" | "subtle"
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: session, isPending: sessionPending } = useSession()
  const userId = session?.user?.id
  const signedIn = Boolean(userId)

  const { data: ids = [] } = useQuery({
    // Scope by user so logout / account switches never reuse another session's cache.
    queryKey: ["favorite-ids", userId ?? "anonymous"],
    queryFn: fetchFavoriteIds,
    enabled: signedIn,
    staleTime: 30_000,
  })

  React.useEffect(() => {
    if (sessionPending || signedIn) return
    queryClient.removeQueries({ queryKey: ["favorite-ids"] })
    queryClient.removeQueries({ queryKey: ["favorites"] })
  }, [sessionPending, signedIn, queryClient])

  const favorited =
    signedIn && repositoryId ? ids.includes(repositoryId) : false

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryId, fullName }),
        })
        if (!res.ok) throw new Error("Could not save favorite")
        return res.json() as Promise<{ repositoryId: string }>
      }
      const qs = new URLSearchParams(
        repositoryId
          ? { repositoryId }
          : { fullName }
      )
      const res = await fetch(`/api/favorites?${qs}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not remove favorite")
      return res.json() as Promise<{ repositoryId: string }>
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["favorite-ids"] })
      await queryClient.invalidateQueries({ queryKey: ["favorites"] })
    },
    onError: (err) => {
      toast.error((err as Error).message)
    },
  })

  if (tone === "subtle") {
    return (
      <button
        type="button"
        aria-pressed={favorited}
        aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
        disabled={mutation.isPending}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center border border-border/70 bg-background/60 text-muted-foreground transition-colors",
          "hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
          favorited &&
            "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20",
          className
        )}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!signedIn) {
            router.push(
              `/sign-in?next=${encodeURIComponent(window.location.pathname)}`
            )
            return
          }
          mutation.mutate(!favorited)
        }}
      >
        <HeartIcon
          className="size-3.5"
          weight={favorited ? "fill" : "regular"}
        />
      </button>
    )
  }

  return (
    <Button
      type="button"
      variant={favorited ? "default" : "outline"}
      size={size}
      className={cn(className)}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      disabled={mutation.isPending}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!signedIn) {
          router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`)
          return
        }
        mutation.mutate(!favorited)
      }}
    >
      <HeartIcon
        className={cn(size === "icon" ? "size-4" : undefined)}
        weight={favorited ? "fill" : "regular"}
        data-icon={size === "icon" ? undefined : "inline-start"}
      />
      {size === "icon" ? null : favorited ? "Saved" : "Favorite"}
    </Button>
  )
}
