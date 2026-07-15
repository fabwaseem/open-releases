import { Suspense } from "react"

import { AuthForm } from "@/components/auth/auth-form"
import { AuthShell } from "@/components/auth/auth-shell"
import { Skeleton } from "@/components/ui/skeleton"

export default function SignInPage() {
  return (
    <AuthShell mode="sign-in">
      <Suspense fallback={<Skeleton className="h-[28rem] w-full" />}>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthShell>
  )
}
