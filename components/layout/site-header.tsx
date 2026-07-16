"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowRightIcon,
  GearSixIcon,
  HeartIcon,
  SignInIcon,
  SignOutIcon,
} from "@phosphor-icons/react"

import { BrandMark } from "@/components/layout/brand-mark"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOut, useSession } from "@/lib/auth-client"

function userInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "?"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function SiteHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const user = session?.user
  const isAdmin = user?.role === "admin"
  const showAdminBar = isAdmin && !pathname.startsWith("/admin")
  const favoritesActive = pathname.startsWith("/favorites")

  return (
    <header className="relative z-20 border-b border-border/60 bg-background/70 backdrop-blur-md">
      {showAdminBar ? (
        <Link
          href="/admin"
          className="group flex items-center justify-center gap-2 border-b border-primary/30 bg-primary px-4 py-2 text-center text-xs font-semibold tracking-widest text-primary-foreground uppercase transition-colors hover:bg-primary/90"
        >
          <GearSixIcon className="size-3.5 shrink-0" />
          <span>You&apos;re signed in as admin — open the admin panel</span>
          <ArrowRightIcon className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}

      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-base transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <BrandMark />
        </Link>

        <nav className="flex items-center gap-2">
          <ThemeToggle />

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                aria-label="Account menu"
              >
                <Avatar size="lg" className="cursor-pointer">
                  {user.image ? (
                    <AvatarImage
                      src={user.image}
                      alt={user.name || "Account"}
                    />
                  ) : null}
                  <AvatarFallback>
                    {userInitials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/favorites")}>
                  <HeartIcon
                    className="size-4"
                    weight={favoritesActive ? "fill" : "regular"}
                  />
                  Favorites
                </DropdownMenuItem>
                {isAdmin ? (
                  <DropdownMenuItem onClick={() => router.push("/admin")}>
                    <GearSixIcon className="size-4" />
                    Admin panel
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await signOut()
                    router.refresh()
                    router.push("/")
                  }}
                >
                  <SignOutIcon className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : isPending ? (
            <Avatar size="lg" className="animate-pulse">
              <AvatarFallback />
            </Avatar>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                render={<Link href="/sign-in" />}
              >
                <SignInIcon data-icon="inline-start" />
                Sign in
              </Button>
              <Button size="sm" render={<Link href="/sign-up" />}>
                Sign up
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
