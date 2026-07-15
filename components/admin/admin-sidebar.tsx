"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChartBarIcon,
  FolderIcon,
  GearSixIcon,
  TrayIcon,
  UsersIcon,
} from "@phosphor-icons/react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

const navItems = [
  {
    title: "Overview",
    href: "/admin",
    icon: ChartBarIcon,
    match: (pathname: string) => pathname === "/admin",
  },
  {
    title: "Submissions",
    href: "/admin/submissions",
    icon: TrayIcon,
    match: (pathname: string) => pathname.startsWith("/admin/submissions"),
  },
  {
    title: "Repositories",
    href: "/admin/repositories",
    icon: FolderIcon,
    match: (pathname: string) => pathname.startsWith("/admin/repositories"),
  },
  {
    title: "Users",
    href: "/admin/users",
    icon: UsersIcon,
    match: (pathname: string) => pathname.startsWith("/admin/users"),
  },
] as const

export function AdminSidebar() {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  function closeMobileNav() {
    if (isMobile) setOpenMobile(false)
  }

  React.useEffect(() => {
    if (isMobile) setOpenMobile(false)
  }, [pathname, isMobile, setOpenMobile])

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="gap-3 px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/admin" onClick={closeMobileNav} />}
              tooltip="Admin"
              className="data-active:bg-transparent"
            >
              <div className="flex size-8 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground">
                <GearSixIcon className="size-4" weight="bold" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-heading font-semibold">
                  Releases
                </span>
                <span className="truncate text-[0.65rem] tracking-widest text-muted-foreground uppercase">
                  Admin console
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={item.match(pathname)}
                    tooltip={item.title}
                    render={<Link href={item.href} onClick={closeMobileNav} />}
                  >
                    <item.icon
                      weight={item.match(pathname) ? "fill" : "regular"}
                    />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
