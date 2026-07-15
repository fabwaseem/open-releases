"use client"

import Image from "next/image"
import Link from "next/link"
import { GithubLogoIcon, StarIcon } from "@phosphor-icons/react"

import { PlatformBadges } from "@/components/directory/platform-badges"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { formatRelativeDate, formatStars } from "@/lib/format"
import type { CatalogRepo } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ReleaseCard({ repo }: { repo: CatalogRepo }) {
  const tag = repo.latest_release?.tag
  const topics = (repo.topics ?? []).slice(0, 4)

  return (
    <Link
      href={`/repo/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
      className="group block h-full"
    >
      <Card
        size="sm"
        className={cn(
          "h-full rounded-2xl bg-card/80 ring-1 ring-border/60 transition-[transform,box-shadow,background-color] duration-200",
          "hover:-translate-y-0.5 hover:bg-card hover:ring-primary/40 hover:shadow-[0_12px_40px_-20px_oklch(0.55_0.22_25_/_0.55)]"
        )}
      >
        <CardHeader className="gap-3">
          <div className="flex items-start gap-3">
            <div className="relative size-11 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border/50">
              {repo.avatar_url ? (
                <Image
                  src={repo.avatar_url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="44px"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-xs font-semibold uppercase text-muted-foreground">
                  {(repo.name ?? "?").slice(0, 2)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-heading truncate text-base font-semibold tracking-tight text-foreground">
                  {repo.name}
                </h3>
                {tag ? (
                  <Badge
                    className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-[0.6rem] tracking-wide text-primary-foreground"
                    variant="default"
                  >
                    {tag}
                  </Badge>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{repo.full_name}</p>
            </div>
          </div>
          <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
            {repo.description || "No description provided."}
          </p>
          {topics.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-md bg-muted/70 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground"
                >
                  #{topic}
                </span>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0">
          <PlatformBadges platforms={repo.platforms} />
        </CardContent>
        <CardFooter className="mt-auto flex items-center justify-between gap-3 border-t border-border/50 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-amber-300">
            <StarIcon className="size-3.5" weight="fill" />
            {formatStars(repo.stars)}
          </span>
          <span className="inline-flex items-center gap-1 truncate">
            <GithubLogoIcon className="size-3.5 shrink-0" />
            {repo.license || "No license"}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatRelativeDate(repo.latest_release?.published_at)}
          </span>
        </CardFooter>
      </Card>
    </Link>
  )
}