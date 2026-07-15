"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { GithubLogoIcon, GoogleLogoIcon } from "@phosphor-icons/react"
import { useForm } from "react-hook-form"
import toast from "react-hot-toast"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, signUp } from "@/lib/auth-client"
import {
  signInSchema,
  signUpSchema,
  type SignInValues,
  type SignUpValues,
} from "@/lib/auth-schemas"
import { cn } from "@/lib/utils"

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/"
  const [oauthPending, setOauthPending] = React.useState<
    "google" | "github" | null
  >(null)

  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  })

  const signUpForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  })

  const formPending =
    mode === "sign-in"
      ? signInForm.formState.isSubmitting
      : signUpForm.formState.isSubmitting
  const busy = formPending || oauthPending != null

  async function onSocial(provider: "google" | "github") {
    setOauthPending(provider)
    try {
      const { error } = await signIn.social({
        provider,
        callbackURL: next,
      })
      if (error) throw new Error(error.message || `${provider} sign-in failed`)
    } catch (err) {
      toast.error((err as Error).message)
      setOauthPending(null)
    }
  }

  async function handleSignIn(values: SignInValues) {
    const { error } = await signIn.email(values)
    if (error) {
      toast.error(error.message || "Sign in failed")
      return
    }
    toast.success("Welcome back")
    router.push(next)
    router.refresh()
  }

  async function handleSignUp(values: SignUpValues) {
    const { error } = await signUp.email(values)
    if (error) {
      toast.error(error.message || "Sign up failed")
      return
    }
    toast.success("Account created")
    router.push(next)
    router.refresh()
  }

  return (
    <div className="border border-border/70 bg-card/70 p-6 shadow-[0_24px_80px_-40px_oklch(0.55_0.22_25_/_0.55)] backdrop-blur-md sm:p-8">
      <div className="mb-7 space-y-1.5">
        <p className="text-[0.65rem] font-semibold tracking-[0.2em] text-primary uppercase">
          {mode === "sign-in" ? "Welcome back" : "Get started"}
        </p>
        <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </h1>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => void onSocial("google")}
        >
          <GoogleLogoIcon data-icon="inline-start" weight="bold" />
          {oauthPending === "google" ? "Redirecting…" : "Google"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => void onSocial("github")}
        >
          <GithubLogoIcon data-icon="inline-start" weight="bold" />
          {oauthPending === "github" ? "Redirecting…" : "GitHub"}
        </Button>
      </div>

      <div className="relative my-7">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border/60" />
        </div>
        <div className="relative flex justify-center text-[0.65rem] font-semibold tracking-widest uppercase">
          <span className="bg-card px-3 text-muted-foreground">
            or with email
          </span>
        </div>
      </div>

      {mode === "sign-in" ? (
        <form
          className="space-y-4"
          onSubmit={signInForm.handleSubmit(handleSignIn)}
          noValidate
        >
          <Field
            id="email"
            label="Email"
            error={signInForm.formState.errors.email?.message}
          >
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="h-11"
              disabled={busy}
              aria-invalid={Boolean(signInForm.formState.errors.email)}
              {...signInForm.register("email")}
            />
          </Field>
          <Field
            id="password"
            label="Password"
            error={signInForm.formState.errors.password?.message}
          >
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="At least 8 characters"
              className="h-11"
              disabled={busy}
              aria-invalid={Boolean(signInForm.formState.errors.password)}
              {...signInForm.register("password")}
            />
          </Field>
          <Button type="submit" className="mt-2 h-11 w-full" disabled={busy}>
            {formPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={signUpForm.handleSubmit(handleSignUp)}
          noValidate
        >
          <Field
            id="name"
            label="Name"
            error={signUpForm.formState.errors.name?.message}
          >
            <Input
              id="name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              className="h-11"
              disabled={busy}
              aria-invalid={Boolean(signUpForm.formState.errors.name)}
              {...signUpForm.register("name")}
            />
          </Field>
          <Field
            id="email"
            label="Email"
            error={signUpForm.formState.errors.email?.message}
          >
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="h-11"
              disabled={busy}
              aria-invalid={Boolean(signUpForm.formState.errors.email)}
              {...signUpForm.register("email")}
            />
          </Field>
          <Field
            id="password"
            label="Password"
            error={signUpForm.formState.errors.password?.message}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="h-11"
              disabled={busy}
              aria-invalid={Boolean(signUpForm.formState.errors.password)}
              {...signUpForm.register("password")}
            />
          </Field>
          <Button type="submit" className="mt-2 h-11 w-full" disabled={busy}>
            {formPending ? "Creating…" : "Create account"}
          </Button>
        </form>
      )}

      <p className="mt-7 text-center text-sm text-muted-foreground">
        {mode === "sign-in" ? (
          <>
            No account?{" "}
            <Link
              href={`/sign-up?next=${encodeURIComponent(next)}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link
              href={`/sign-in?next=${encodeURIComponent(next)}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </>
        )}
      </p>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        By continuing you agree to our{" "}
        <Link
          href="/terms"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          Terms
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  )
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p
        className={cn(
          "min-h-4 text-xs text-destructive transition-opacity",
          error ? "opacity-100" : "opacity-0"
        )}
      >
        {error ?? " "}
      </p>
    </div>
  )
}
