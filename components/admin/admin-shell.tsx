"use client"

import type { CSSProperties, ReactNode } from "react"

import { AdminHeader } from "@/components/admin/admin-header"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider
      defaultOpen
      className="min-h-svh bg-background"
      style={
        {
          "--sidebar-width": "16.5rem",
        } as CSSProperties
      }
    >
      <AdminSidebar />
      <SidebarInset className="min-w-0 overflow-x-hidden">
        <AdminHeader />
        <div className="relative flex-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,oklch(0.5_0.22_25_/_0.14),transparent_70%)]"
          />
          <div className="relative mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
