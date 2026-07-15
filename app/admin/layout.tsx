import type { ReactNode } from "react"
import type { Metadata } from "next"

import { AdminShell } from "@/components/admin/admin-shell"
import { buildMetadata } from "@/lib/seo"
import { requireAdmin } from "@/lib/session"

export const metadata: Metadata = buildMetadata({
  title: "Admin",
  description: "Manage Open Releases catalog, submissions, and users.",
  path: "/admin",
  noIndex: true,
})

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return <AdminShell>{children}</AdminShell>
}
