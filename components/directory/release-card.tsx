"use client"

import Image from "next/image"
import Link from "next/link"
import { GithubLogoIcon, StarIcon } from "@phosphor-icons/react"

import { FeatureButton } from "@/components/admin/feature-button"
import { PlatformBadges } from "@/components/directory/platform-badges"
import { FavoriteButton } from "@/components/favorites/favorite-button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { formatRelativeDate, formatStars } from "@/lib/format"
import type { CatalogRepo } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ReleaseCard({ repo }: { repo: CatalogRepo }) {
  const tag = repo.latest_release?.tag
  const topics = (repo.topics ?? []).slice(0, 4)
  const href = `/repo/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`

  return (
    <Card
      size="sm"
      className={cn(
        "relative h-full rounded-2xl bg-card/80 ring-1 ring-border/60 transition-[transform,box-shadow,background-color] duration-200",
        "hover:-translate-y-0.5 hover:bg-card hover:ring-primary/40 hover:shadow-[0_12px_40px_-20px_oklch(0.55_0.22_25_/_0.55)]"
      )}
    >
      {/* Outside the link so actions don’t trigger NextTopLoader. */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5">
        <FeatureButton
          repositoryId={repo.id}
          featured={repo.featured}
          tone="subtle"
        />
        <FavoriteButton
          repositoryId={repo.id}
          fullName={repo.full_name}
          tone="subtle"
        />
      </div>

      <Link href={href} className="group flex h-full flex-col gap-4">
        <CardHeader className="gap-3 pr-16">
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
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="font-heading truncate text-base font-semibold tracking-tight text-foreground">
                  {repo.name}
                </h3>
                {repo.featured ? (
                  <span className="shrink-0 bg-primary/15 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest text-primary uppercase">
                    Featured
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <p className="truncate text-xs text-foreground/65">
                  {repo.full_name}
                </p>
                {tag ? (
                  <span
                    title={tag}
                    className="inline-flex h-5 max-w-24 shrink-0 items-center truncate border border-border bg-muted px-1.5 font-mono text-[0.65rem] text-foreground/75"
                  >
                    {tag}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-foreground/70">
            {repo.description || "No description provided."}
          </p>
          {topics.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] text-foreground/65"
                >
                  #{topic}
                </span>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          <PlatformBadges platforms={repo.platforms} />
        </CardContent>
        <CardFooter className="mt-auto flex items-center justify-between gap-3 border-t border-border text-xs text-foreground/65">
          <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-300">
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
      </Link>
    </Card>
  )
}
