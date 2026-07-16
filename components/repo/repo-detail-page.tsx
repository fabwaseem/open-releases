"use client"

import Image from "next/image"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  GithubLogoIcon,
  GlobeIcon,
  StarIcon,
} from "@phosphor-icons/react"

import { FeatureButton } from "@/components/admin/feature-button"
import { PlatformBadges } from "@/components/directory/platform-badges"
import { FavoriteButton } from "@/components/favorites/favorite-button"
import { SiteFooter } from "@/components/layout/site-footer"
import { SiteHeader } from "@/components/layout/site-header"
import { NotFoundView } from "@/components/not-found/not-found-view"
import { ReleaseNotes } from "@/components/markdown/release-notes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useDetectedDevice } from "@/hooks/use-detected-device"
import { fetchRepoDetail, queryKeys } from "@/lib/api-client"
import { brandCopy } from "@/lib/brand"
import { pickBestDownload } from "@/lib/device"
import {
  formatBytes,
  formatRelativeDate,
  formatStars,
  platformLabel,
} from "@/lib/format"
import type { Platform } from "@/lib/types"
import { cn } from "@/lib/utils"

export function RepoDetailPage({
  owner,
  name,
}: {
  owner: string
  name: string
}) {
  const device = useDetectedDevice()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.repo(owner, name),
    queryFn: () => fetchRepoDetail(owner, name),
  })

  if (isLoading) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main id="main" className="flex-1">
          <RepoDetailSkeleton />
        </main>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <NotFoundView
        title={brandCopy.notFound.repoTitle}
        description={
          (error as Error)?.message || brandCopy.notFound.repoDescription
        }
        ctaLabel={brandCopy.notFound.repoCta}
      />
    )
  }

  const { catalog, live } = data
  const description = live?.description ?? catalog.description
  const stars = live?.stars ?? catalog.stars
  const topics = live?.topics?.length ? live.topics : catalog.topics
  const release = live?.latest_release
  const assets =
    release?.assets?.length && release.assets.length > 0
      ? release.assets
      : catalog.latest_release.assets
  const platforms = (catalog.platforms ?? []) as Platform[]
  const tag = release?.tag ?? catalog.latest_release.tag
  const published =
    release?.published_at ?? catalog.latest_release.published_at
  const releaseUrl =
    release?.html_url ?? catalog.latest_release.url ?? catalog.url
  const homepage = live?.homepage || catalog.homepage
  const body = release?.body

  const bestDownload =
    device != null ? pickBestDownload(assets, device) : null
  const hasDetectedPlatform =
    device?.platform != null && platforms.includes(device.platform)

  const assetsByPlatform = platforms.reduce(
    (acc, platform) => {
      acc[platform] = assets.filter((asset) => asset.platform === platform)
      return acc
    },
    {} as Record<string, typeof assets>
  )

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.2_25_/_0.18),transparent_65%)]"
      />

      <main
        id="main"
        className="relative mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 pb-10 sm:px-6 sm:py-8 sm:pb-14 lg:px-8 lg:py-12 lg:pb-16"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 sm:mb-6">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl px-2"
            render={<Link href="/" />}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {brandCopy.repo.back}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <FeatureButton
              repositoryId={catalog.id}
              featured={catalog.featured}
              size="sm"
            />
            <FavoriteButton
              repositoryId={catalog.id}
              fullName={catalog.full_name}
              size="sm"
            />
          </div>
        </div>

        <section className="overflow-hidden border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              <div className="relative size-16 shrink-0 overflow-hidden bg-muted ring-1 ring-border/60 sm:size-24">
                {catalog.avatar_url ? (
                  <Image
                    src={catalog.avatar_url}
                    alt={`${catalog.name} avatar`}
                    fill
                    className="object-cover"
                    sizes="96px"
                    priority
                  />
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-4xl">
                    {catalog.name}
                  </h1>
                  {catalog.featured ? (
                    <Badge
                      variant="secondary"
                      className="rounded-none bg-primary/15 text-primary uppercase"
                    >
                      Featured
                    </Badge>
                  ) : null}
                  {tag ? (
                    <Badge className="rounded-md bg-primary px-2.5 py-1 text-[0.65rem] text-primary-foreground">
                      {tag}
                    </Badge>
                  ) : null}
                  {(release?.prerelease || catalog.latest_release.prerelease) && (
                    <Badge variant="secondary" className="rounded-md uppercase">
                      Pre-release
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {catalog.full_name}
                </p>
                <p className="mt-4 max-w-3xl text-base leading-relaxed text-pretty text-muted-foreground">
                  {description || "No description"}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-300">
                    <StarIcon className="size-4" weight="fill" />
                    {formatStars(stars)}
                  </span>
                  {live ? (
                    <>
                      <span className="text-muted-foreground">
                        {formatStars(live.forks)} forks
                      </span>
                      <span className="text-muted-foreground">
                        {live.open_issues} open issues
                      </span>
                    </>
                  ) : null}
                  <span className="text-muted-foreground">
                    Released {formatRelativeDate(published)}
                  </span>
                </div>

                <div className="mt-4">
                  <PlatformBadges platforms={platforms} />
                </div>
              </div>
            </div>

            <div className="flex w-full shrink-0 flex-col gap-3 border border-border/50 bg-background/40 p-4 lg:w-80">
              <p className="text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">
                Get the app
              </p>
              {bestDownload && hasDetectedPlatform ? (
                <Button
                  size="lg"
                  className="h-12 w-full rounded-xl shadow-[0_10px_30px_-16px_oklch(0.55_0.22_25_/_0.7)]"
                  render={
                    <a
                      href={bestDownload.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                    />
                  }
                >
                  <DownloadSimpleIcon data-icon="inline-start" />
                  Download for {platformLabel(device!.platform!)}
                </Button>
              ) : device?.platform && !hasDetectedPlatform ? (
                <Button size="lg" className="h-12 w-full rounded-xl" disabled>
                  No {platformLabel(device.platform)} build
                </Button>
              ) : (
                <Button size="lg" className="h-12 w-full rounded-xl" disabled>
                  Detecting device…
                </Button>
              )}

              {bestDownload && hasDetectedPlatform ? (
                <p className="truncate text-xs text-muted-foreground">
                  {bestDownload.name}
                  {bestDownload.size != null
                    ? ` · ${formatBytes(bestDownload.size)}`
                    : ""}
                  {device?.arch && device.arch !== "unknown"
                    ? ` · ${device.arch}`
                    : ""}
                </p>
              ) : device?.platform && !hasDetectedPlatform ? (
                <p className="text-xs text-muted-foreground">
                  This release has no installer for{" "}
                  {platformLabel(device.platform)}.
                </p>
              ) : null}

              <div className="mt-1 flex flex-wrap gap-2 border-t border-border/40 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-xl"
                  render={
                    <a href={catalog.url} target="_blank" rel="noreferrer" />
                  }
                >
                  <GithubLogoIcon data-icon="inline-start" />
                  GitHub
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-xl"
                  render={
                    <a href={releaseUrl} target="_blank" rel="noreferrer" />
                  }
                >
                  Notes
                  <ArrowSquareOutIcon data-icon="inline-end" />
                </Button>
                {homepage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full rounded-xl"
                    render={
                      <a href={homepage} target="_blank" rel="noreferrer" />
                    }
                  >
                    <GlobeIcon data-icon="inline-start" />
                    Website
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {topics?.length ? (
            <>
              <Separator className="my-6" />
              <div className="flex flex-wrap gap-2">
                {topics.map((topic) => (
                  <span
                    key={topic}
                    className="bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    #{topic}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-heading text-2xl font-semibold tracking-tight">
                Downloads
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Latest installers for Windows, macOS, Linux, Android, and iOS.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {live ? "Live from GitHub" : "From catalog snapshot"}
            </p>
          </div>

          {assets.length === 0 ? (
            <div className="border border-border/50 bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
              No installers found on the latest release.
            </div>
          ) : (
            <div className="grid gap-3">
              {platforms.map((platform) => {
                const group = assetsByPlatform[platform] ?? []
                if (!group.length) return null
                const isDetected = device?.platform === platform
                return (
                  <div
                    key={platform}
                    className={cn(
                      "w-full border border-border/50 bg-card/40 p-4",
                      isDetected && "border-primary/40 ring-1 ring-primary/30"
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {platformLabel(platform)}
                      </h3>
                      {isDetected ? (
                        <Badge className="rounded-none bg-primary/15 px-2 py-0.5 text-[0.6rem] text-primary">
                          Your device
                        </Badge>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      {group.map((asset) => {
                        const isBest = bestDownload?.url === asset.url
                        return (
                          <a
                            key={asset.url}
                            href={asset.url}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              "flex items-center justify-between gap-3 border px-3 py-3 transition-colors",
                              isBest
                                ? "border-primary/50 bg-primary/10 hover:bg-primary/15"
                                : "border-border/50 bg-background/40 hover:border-primary/40 hover:bg-muted/40"
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {asset.name}
                              </p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {formatBytes(asset.size)}
                                {asset.download_count != null
                                  ? ` · ${formatStars(asset.download_count)} downloads`
                                  : ""}
                                {isBest ? " · recommended" : ""}
                              </p>
                            </div>
                            <DownloadSimpleIcon className="size-5 shrink-0 text-primary" />
                          </a>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {body ? (
          <section className="mt-8 border border-border/50 bg-card/40 p-4 sm:p-5">
            <h2 className="font-heading text-base font-semibold tracking-tight">
              What’s new
            </h2>
            <div className="mt-3">
              <ScrollArea className="w-full max-h-[min(28rem,60vh)] pr-3 *:data-[slot=scroll-area-viewport]:max-h-[min(28rem,60vh)] *:data-[slot=scroll-area-viewport]:h-auto">
                <ReleaseNotes markdown={body} />
              </ScrollArea>
            </div>
          </section>
        ) : null}

        <section className="mt-8 grid gap-3 border border-border/50 bg-card/30 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Meta
            label="Language"
            value={live?.language || catalog.language || "—"}
          />
          <Meta label="License" value={live?.license || catalog.license || "—"} />
          <Meta
            label="Releases"
            value={
              catalog.releases_count != null
                ? String(catalog.releases_count)
                : "—"
            }
          />
          <Meta
            label="Last push"
            value={formatRelativeDate(live?.pushed_at || catalog.pushed_at)}
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function RepoDetailSkeleton() {
  return (
    <div className="relative min-h-svh bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.2_25_/_0.18),transparent_65%)]"
      />

      <div className="relative mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
        <Skeleton className="mb-4 h-8 w-28 sm:mb-6" />

        {/* Hero */}
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm sm:rounded-3xl sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              <Skeleton className="size-16 shrink-0 rounded-2xl sm:size-24" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-9 w-48 sm:h-10 sm:w-64" />
                  <Skeleton className="h-6 w-16" />
                </div>
                <Skeleton className="h-4 w-40" />
                <div className="space-y-2 pt-1">
                  <Skeleton className="h-4 w-full max-w-3xl" />
                  <Skeleton className="h-4 w-3/4 max-w-2xl" />
                </div>
                <div className="flex flex-wrap gap-4 pt-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-6 w-14" />
                </div>
              </div>
            </div>

            <div className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="mx-auto h-3 w-40 lg:mx-0" />
              <div className="mt-1 flex gap-2">
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-9 flex-1" />
              </div>
            </div>
          </div>

          <Separator className="my-6" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20" />
            ))}
          </div>
        </section>

        {/* Downloads */}
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-8 w-36" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="grid gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border/60 bg-card/50 p-4"
              >
                <Skeleton className="mb-4 h-5 w-24" />
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* What’s new */}
        <section className="mt-8">
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4 sm:p-6">
            <Skeleton className="mb-4 h-5 w-28" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-4 h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </section>

        {/* Meta */}
        <section className="mt-8 grid gap-3 rounded-2xl border border-border/50 bg-card/40 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}