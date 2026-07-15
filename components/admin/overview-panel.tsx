"use client"

import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  FolderIcon,
  HardDrivesIcon,
  HeartIcon,
  TrayIcon,
  UsersIcon,
} from "@phosphor-icons/react"

import { AdminPageHeader } from "@/components/admin/admin-page-header"
import type { AdminStats } from "@/components/admin/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  href,
}: {
  label: string
  value: string | number
  icon: ComponentType<{ className?: string }>
  hint?: string
  href?: string
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-2 font-heading text-3xl font-bold tabular-nums">
            {value}
          </p>
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <div className="flex size-9 items-center justify-center border border-border/60 bg-background/60 text-primary">
          <Icon className="size-4" />
        </div>
      </div>
      {href ? (
        <span className="mt-4 inline-flex items-center gap-1 text-[0.65rem] font-semibold tracking-widest text-primary uppercase opacity-0 transition-opacity group-hover:opacity-100">
          Open <ArrowRightIcon className="size-3" />
        </span>
      ) : null}
    </>
  )

  const className = cn(
    "group border border-border/60 bg-card/50 p-4 transition-colors",
    href && "hover:border-primary/40 hover:bg-card/80"
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    )
  }

  return <div className={className}>{body}</div>
}

function Panel({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border border-border/60 bg-card/40">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function OverviewPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/stats")
      if (!res.ok) throw new Error("Failed to load stats")
      return res.json() as Promise<AdminStats>
    },
  })

  if (isLoading) {
    return (
      <div>
        <AdminPageHeader
          title="Overview"
          description="Catalog health, users, and recent activity."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div>
        <AdminPageHeader title="Overview" />
        <p className="text-sm text-destructive">Could not load admin stats.</p>
      </div>
    )
  }

  const t = data.totals
  const maxLang = Math.max(...data.topLanguages.map((l) => l.count), 1)

  return (
    <div>
      <AdminPageHeader
        title="Overview"
        description="Catalog health, users, and recent activity across the directory."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/admin/submissions" />}
            >
              Review submissions
            </Button>
            <Button size="sm" render={<Link href="/admin/repositories" />}>
              Manage repos
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <StatCard
            label="Pending reviews"
            value={t.pendingSubmissions}
            icon={TrayIcon}
            hint="User-submitted repos"
            href="/admin/submissions"
          />
          <StatCard
            label="Visible repos"
            value={t.visibleRepos}
            icon={FolderIcon}
            hint={`${t.repositories} total · ${t.hiddenRepos} hidden`}
            href="/admin/repositories"
          />
          <StatCard
            label="Users"
            value={t.users}
            icon={UsersIcon}
            hint={`${t.admins} admins · ${t.bannedUsers} banned`}
            href="/admin/users"
          />
          <StatCard label="Favorites" value={t.favorites} icon={HeartIcon} />
          <StatCard
            label="Platforms"
            value={`${t.platforms.windows}/${t.platforms.macos}/${t.platforms.linux}`}
            icon={HardDrivesIcon}
            hint="Win / Mac / Linux"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Scrape ledger">
            <ul className="space-y-2">
              {data.scrapeByStatus.map((row) => (
                <li
                  key={row.status}
                  className="flex items-center justify-between gap-3 border border-border/40 bg-background/40 px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                    {row.status}
                  </span>
                  <span className="tabular-nums font-medium">{row.count}</span>
                </li>
              ))}
              {data.scrapeByStatus.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  No scrape records yet.
                </li>
              ) : null}
            </ul>
          </Panel>

          <Panel title="Top languages">
            <ul className="space-y-3">
              {data.topLanguages.map((lang) => (
                <li key={lang.name} className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span>{lang.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {lang.count}
                    </span>
                  </div>
                  <div className="h-1 bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(lang.count / maxLang) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
              {data.topLanguages.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  No language data yet.
                </li>
              ) : null}
            </ul>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Recently scraped"
            action={
              <Button
                variant="ghost"
                size="xs"
                render={<Link href="/admin/repositories" />}
              >
                View all
              </Button>
            }
          >
            <ul className="divide-y divide-border/50">
              {data.recentRepos.map((repo) => (
                <li key={repo.id} className="py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/repo/${repo.fullName}`}
                    className="font-medium hover:text-primary"
                  >
                    {repo.fullName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {repo.stars.toLocaleString()} stars · score{" "}
                    {repo.activityScore.toFixed(1)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Newest users"
            action={
              <Button
                variant="ghost"
                size="xs"
                render={<Link href="/admin/users" />}
              >
                View all
              </Button>
            }
          >
            <ul className="divide-y divide-border/50">
              {data.recentUsers.map((user) => (
                <li key={user.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-medium">
                    {user.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      · {user.role}
                      {user.banned ? " · banned" : ""}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}
