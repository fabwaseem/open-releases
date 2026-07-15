"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { HeartIcon } from "@phosphor-icons/react"

import { ReleaseCard } from "@/components/directory/release-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { brandCopy } from "@/lib/brand"
import type { CatalogRepo } from "@/lib/types"

export function FavoritesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["favorites"],
    queryFn: async () => {
      const res = await fetch("/api/favorites")
      if (!res.ok) throw new Error("Failed to load favorites")
      return res.json() as Promise<{ items: CatalogRepo[]; count: number }>
    },
  })

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-8">
        <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-primary uppercase">
          {brandCopy.favorites.eyebrow}
        </p>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {brandCopy.favorites.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {brandCopy.favorites.description}
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load favorites.</p>
      ) : !data?.items.length ? (
        <div className="border border-border/60 bg-card/40 px-6 py-16 text-center">
          <HeartIcon className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 font-heading text-xl font-semibold">
            {brandCopy.favorites.emptyTitle}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {brandCopy.favorites.emptyBody}
          </p>
          <Button className="mt-6" render={<Link href="/" />}>
            {brandCopy.favorites.cta}
          </Button>
        </div>
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
