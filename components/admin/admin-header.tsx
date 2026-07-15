"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowSquareOutIcon,
  SignOutIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { signOut, useSession } from "@/lib/auth-client"

const titles: Record<string, string> = {
  "/admin": "Overview",
  "/admin/submissions": "Submissions",
  "/admin/repositories": "Repositories",
  "/admin/users": "Users",
}

export function AdminHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const user = session?.user
  const pageTitle = titles[pathname] ?? "Admin"

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-3 backdrop-blur-md sm:gap-3 sm:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 hidden h-4 sm:block" />

      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:inline-flex">
            <BreadcrumbLink render={<Link href="/admin" />}>
              Admin
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <Button variant="outline" size="sm" render={<Link href="/" />}>
          <ArrowSquareOutIcon data-icon="inline-start" />
          <span className="sm:hidden">Site</span>
          <span className="hidden sm:inline">View site</span>
        </Button>

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-9 items-center gap-2 border border-border bg-transparent px-3 text-xs font-semibold tracking-widest uppercase hover:bg-muted">
              <UserCircleIcon className="size-4" />
              <span className="hidden max-w-28 truncate normal-case tracking-normal md:inline">
                {user.name}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
                <p className="mt-1 text-[0.65rem] font-semibold tracking-widest text-primary uppercase">
                  Admin
                </p>
              </div>
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
        ) : null}
      </div>
    </header>
  )
}
