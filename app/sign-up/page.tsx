import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthForm } from "@/components/auth/auth-form"
import { AuthShell } from "@/components/auth/auth-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { brandCopy } from "@/lib/brand"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Create account",
  description: brandCopy.auth.signUpSupport,
  path: "/sign-up",
  noIndex: true,
})

export default function SignUpPage() {
  return (
    <AuthShell mode="sign-up">
      <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthShell>
  )
}
