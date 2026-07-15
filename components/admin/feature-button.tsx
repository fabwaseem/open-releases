"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PushPinIcon } from "@phosphor-icons/react"
import toast from "react-hot-toast"

import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

export function FeatureButton({
  repositoryId,
  featured: featuredProp,
  className,
  size = "default",
  tone = "default",
}: {
  repositoryId?: string
  featured: boolean
  className?: string
  size?: "default" | "sm" | "icon"
  tone?: "default" | "subtle"
}) {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"
  const [featured, setFeatured] = React.useState(featuredProp)

  React.useEffect(() => {
    setFeatured(featuredProp)
  }, [featuredProp])

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (!repositoryId) throw new Error("Missing repository")
      const res = await fetch("/api/admin/repositories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: repositoryId, featured: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Could not update featured status")
      }
      return res.json() as Promise<{ featured: boolean }>
    },
    onMutate: (next) => {
      setFeatured(next)
    },
    onSuccess: async (data) => {
      setFeatured(data.featured)
      toast.success(
        data.featured ? "Featured on directory" : "Removed from featured"
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["releases"] }),
        queryClient.invalidateQueries({ queryKey: ["releases-infinite"] }),
        queryClient.invalidateQueries({ queryKey: ["repo"] }),
      ])
    },
    onError: (err, next) => {
      setFeatured(!next)
      toast.error((err as Error).message)
    },
  })

  if (!isAdmin || !repositoryId) return null

  if (tone === "subtle") {
    return (
      <button
        type="button"
        aria-pressed={featured}
        aria-label={featured ? "Unfeature repository" : "Feature repository"}
        disabled={mutation.isPending}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center border border-border/70 bg-background/60 text-muted-foreground transition-colors",
          "hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
          featured &&
            "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20",
          className
        )}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          mutation.mutate(!featured)
        }}
      >
        <PushPinIcon
          className="size-3.5"
          weight={featured ? "fill" : "regular"}
        />
      </button>
    )
  }

  return (
    <Button
      type="button"
      variant={featured ? "default" : "outline"}
      size={size}
      className={cn(className)}
      aria-pressed={featured}
      aria-label={featured ? "Unfeature repository" : "Feature repository"}
      disabled={mutation.isPending}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        mutation.mutate(!featured)
      }}
    >
      <PushPinIcon
        className={cn(size === "icon" ? "size-4" : undefined)}
        weight={featured ? "fill" : "regular"}
        data-icon={size === "icon" ? undefined : "inline-start"}
      />
      {size === "icon" ? null : featured ? "Featured" : "Feature"}
    </Button>
  )
}
