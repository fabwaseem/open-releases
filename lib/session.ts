import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/lib/auth"

export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  })
}

export async function requireSession() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  return session
}

export async function requireAdmin() {
  const session = await requireSession()
  if (session.user.role !== "admin") {
    redirect("/")
  }
  return session
}

export function isAdminRole(role?: string | null) {
  return role === "admin"
}
