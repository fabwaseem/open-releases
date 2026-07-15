import { Suspense } from "react"

import { AuthForm } from "@/components/auth/auth-form"
import { AuthShell } from "@/components/auth/auth-shell"
import { Skeleton } from "@/components/ui/skeleton"

export default function SignUpPage() {
  return (
    <AuthShell mode="sign-up">
      <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthShell>
  )
}
