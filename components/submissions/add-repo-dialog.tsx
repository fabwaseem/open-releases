"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircleIcon,
  CircleNotchIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import toast from "react-hot-toast"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSession } from "@/lib/auth-client"
import type { RepoPreview } from "@/lib/repo-submission-types"
import { cn } from "@/lib/utils"

export function AddRepoButton({
  className,
  variant = "default",
}: {
  className?: string
  variant?: "default" | "tile"
}) {
  const router = useRouter()
  const { data: session } = useSession()
  const [open, setOpen] = React.useState(false)

  function handleClick() {
    if (!session?.user) {
      router.push(
        `/sign-in?next=${encodeURIComponent(window.location.pathname)}`
      )
      return
    }
    setOpen(true)
  }

  return (
    <>
      {variant === "tile" ? (
        <TooltipProvider delay={200}>
          <Tooltip>
            <TooltipTrigger
              type="button"
              aria-label="Add a repo"
              onClick={handleClick}
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 sm:size-[4.5rem] sm:rounded-2xl",
                className
              )}
            >
              <PlusIcon className="size-5 sm:size-8" weight="bold" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Add a repo</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={className}
          onClick={handleClick}
        >
          <PlusIcon data-icon="inline-start" />
          Add a repo
        </Button>
      )}
      <AddRepoDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function AddRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [url, setUrl] = React.useState("")
  const [note, setNote] = React.useState("")
  const [preview, setPreview] = React.useState<RepoPreview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setUrl("")
      setNote("")
      setPreview(null)
      setError(null)
      setLoadingPreview(false)
      setSubmitting(false)
    }
  }, [open])

  async function fetchPreview() {
    const value = url.trim()
    if (!value || loadingPreview) return

    setLoadingPreview(true)
    setError(null)
    setPreview(null)

    try {
      const res = await fetch("/api/submissions/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        preview?: RepoPreview
        error?: string
      }
      if (!res.ok || !data.preview) {
        setError(data.error || "Could not load repository details.")
        toast.error(data.error || "Could not load repository details.")
        return
      }
      setPreview(data.preview)
      toast.success("Repository details loaded")
    } catch {
      setError("Could not reach the server. Try again.")
      toast.error("Could not reach the server. Try again.")
    } finally {
      setLoadingPreview(false)
    }
  }

  async function submit() {
    if (!preview || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: preview.sourceUrl, note }),
      })
      const data = (await res.json()) as { error?: string; fullName?: string }
      if (!res.ok) {
        toast.error(data.error || "Submission failed")
        setError(data.error || "Submission failed")
        return
      }
      toast.success(`${data.fullName ?? "Repo"} submitted for review`)
      onOpenChange(false)
    } catch {
      toast.error("Could not submit repository")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle className="normal-case tracking-tight">
            Add a repository
          </DialogTitle>
          <DialogDescription>
            Paste a GitHub repository URL, fetch its details, then submit it for
            admin approval. We’ll check for desktop release installers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">GitHub repository URL</Label>
            <Input
              id="repo-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setPreview(null)
                setError(null)
              }}
              placeholder="https://github.com/owner/repo"
              className="h-11"
              disabled={loadingPreview || submitting}
              autoFocus
            />
          </div>

          {error ? (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-3 border border-border/70 bg-card/50 p-4">
              <div className="flex items-start gap-3">
                {preview.avatarUrl ? (
                  <img
                    src={preview.avatarUrl}
                    alt=""
                    className="size-10 border border-border/60 bg-muted object-cover"
                  />
                ) : (
                  <div className="size-10 border border-border/60 bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="size-4 shrink-0 text-primary" />
                    <p className="truncate font-heading text-base font-semibold">
                      {preview.fullName}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preview.description || "No description"}
                  </p>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="border border-border/50 bg-background/40 px-2 py-1.5">
                  <dt className="text-muted-foreground">Stars</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {preview.stars.toLocaleString()}
                  </dd>
                </div>
                <div className="border border-border/50 bg-background/40 px-2 py-1.5">
                  <dt className="text-muted-foreground">Language</dt>
                  <dd className="mt-0.5 font-medium">
                    {preview.language ?? "—"}
                  </dd>
                </div>
                <div className="border border-border/50 bg-background/40 px-2 py-1.5">
                  <dt className="text-muted-foreground">Release</dt>
                  <dd className="mt-0.5 font-medium">{preview.releaseTag}</dd>
                </div>
                <div className="border border-border/50 bg-background/40 px-2 py-1.5">
                  <dt className="text-muted-foreground">Platforms</dt>
                  <dd className="mt-0.5 font-medium capitalize">
                    {preview.platforms.join(" · ") || "—"}
                  </dd>
                </div>
              </dl>

              <div>
                <p className="mb-1.5 text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">
                  Desktop assets ({preview.assets.length})
                </p>
                <ul className="max-h-28 space-y-1 overflow-y-auto text-xs">
                  {preview.assets.slice(0, 8).map((asset) => (
                    <li
                      key={`${asset.platform}-${asset.name}`}
                      className="truncate text-muted-foreground"
                    >
                      <span className="text-foreground capitalize">
                        {asset.platform}
                      </span>
                      {" · "}
                      {asset.name}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <Label htmlFor="repo-note">Note for admins (optional)</Label>
                <Textarea
                  id="repo-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why should this be listed?"
                  className="min-h-20"
                  disabled={submitting}
                />
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting || loadingPreview}
          >
            Cancel
          </Button>
          {preview ? (
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit for approval"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void fetchPreview()}
              disabled={!url.trim() || loadingPreview}
            >
              {loadingPreview ? (
                <>
                  <CircleNotchIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                  Fetching…
                </>
              ) : (
                "Fetch details"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
