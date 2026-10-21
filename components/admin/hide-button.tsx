"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import toast from "react-hot-toast"

import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

export function HideButton({
  repositoryId,
  hidden: hiddenProp = false,
  className,
  size = "default",
  tone = "default",
  onHidden,
}: {
  repositoryId?: string
  hidden?: boolean
  className?: string
  size?: "default" | "sm" | "icon"
  tone?: "default" | "subtle"
  /** Called after a successful hide (e.g. leave the repo detail page). */
  onHidden?: () => void
}) {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"
  const [hidden, setHidden] = React.useState(hiddenProp)

  React.useEffect(() => {
    setHidden(hiddenProp)
  }, [hiddenProp])

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (!repositoryId) throw new Error("Missing repository")
      const res = await fetch("/api/admin/repositories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: repositoryId,
          hidden: next,
          hiddenReason: next ? "Hidden by admin" : null,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Could not update visibility")
      }
      return res.json() as Promise<{ hidden: boolean }>
    },
    onMutate: (next) => {
      setHidden(next)
    },
    onSuccess: async (data) => {
      setHidden(data.hidden)
      toast.success(data.hidden ? "Hidden from directory" : "Visible again")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["releases"] }),
        queryClient.invalidateQueries({ queryKey: ["releases-infinite"] }),
        queryClient.invalidateQueries({ queryKey: ["repo"] }),
      ])
      if (data.hidden) onHidden?.()
    },
    onError: (err, next) => {
      setHidden(!next)
      toast.error((err as Error).message)
    },
  })

  if (!isAdmin || !repositoryId) return null

  if (tone === "subtle") {
    return (
      <button
        type="button"
        aria-pressed={hidden}
        aria-label={hidden ? "Unhide repository" : "Hide repository"}
        disabled={mutation.isPending}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center border border-border/70 bg-background/60 text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
          hidden &&
            "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20",
          className
        )}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          mutation.mutate(!hidden)
        }}
      >
        {hidden ? (
          <EyeIcon className="size-3.5" weight="fill" />
        ) : (
          <EyeSlashIcon className="size-3.5" weight="regular" />
        )}
      </button>
    )
  }

  return (
    <Button
      type="button"
      variant={hidden ? "default" : "outline"}
      size={size}
      className={cn(className)}
      aria-pressed={hidden}
      aria-label={hidden ? "Unhide repository" : "Hide repository"}
      disabled={mutation.isPending}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        mutation.mutate(!hidden)
      }}
    >
      {hidden ? (
        <EyeIcon
          className={cn(size === "icon" ? "size-4" : undefined)}
          weight="fill"
          data-icon={size === "icon" ? undefined : "inline-start"}
        />
      ) : (
        <EyeSlashIcon
          className={cn(size === "icon" ? "size-4" : undefined)}
          weight="regular"
          data-icon={size === "icon" ? undefined : "inline-start"}
        />
      )}
      {size === "icon" ? null : hidden ? "Hidden" : "Hide"}
    </Button>
  )
}
