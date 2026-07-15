import type { ReactNode } from "react"
import type { Metadata } from "next"

import { AdminShell } from "@/components/admin/admin-shell"
import { requireAdmin } from "@/lib/session"

export const metadata: Metadata = {
  title: "Admin",
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return <AdminShell>{children}</AdminShell>
}
