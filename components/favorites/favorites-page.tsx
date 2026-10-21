"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { HeartIcon } from "@phosphor-icons/react"

import { ReleaseCard } from "@/components/directory/release-card"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { brandCopy } from "@/lib/brand"
import type { CatalogRepo } from "@/lib/types"

export function FavoritesPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["favorites"],
    queryFn: async () => {
      const res = await fetch("/api/favorites")
      if (!res.ok) throw new Error("Failed to load favorites")
      return res.json() as Promise<{ items: CatalogRepo[]; count: number }>
    },
  })

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 pb-10 sm:px-6 sm:py-8 sm:pb-14 lg:px-8 lg:py-12 lg:pb-16">
      <div className="mb-6 space-y-2 sm:mb-8">
        <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-primary uppercase sm:text-xs sm:tracking-[0.2em]">
          {brandCopy.favorites.eyebrow}
        </p>
        <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
          {brandCopy.favorites.title}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {brandCopy.favorites.description}
        </p>
      </div>

      {isLoading ? (
        <div
          aria-busy="true"
          aria-label="Loading favorites"
          className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 sm:h-64" />
          ))}
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive"
        >
          <p>Could not load favorites.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      ) : !data?.items.length ? (
        <Empty className="border border-border/60 bg-card/40 px-6 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HeartIcon />
            </EmptyMedia>
            <EmptyTitle className="normal-case tracking-tight">
              {brandCopy.favorites.emptyTitle}
            </EmptyTitle>
            <EmptyDescription>{brandCopy.favorites.emptyBody}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/" />}>
              {brandCopy.favorites.cta}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {data.items.map((repo) => (
            <ReleaseCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
    </div>
  )
}
