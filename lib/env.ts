import { z } from "zod"

/**
 * Server env validated once at import time.
 * Client-safe public vars are also listed so Next inlines stay consistent.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),

  BETTER_AUTH_URL: z.string().url().optional(),

  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),

  /** Google Analytics 4 measurement ID (e.g. G-XXXXXXXX). Public. */
  NEXT_PUBLIC_GA_ID: z
    .string()
    .regex(/^G-[A-Z0-9]+$/, "NEXT_PUBLIC_GA_ID must look like G-XXXXXXXX")
    .optional(),

  GITHUB_TOKEN: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  SHADOW_DATABASE_URL: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function formatZodError(error: z.ZodError) {
  return error.issues
    .map((issue) => `  • ${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("\n")
}

function readRawEnv() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || undefined,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
    NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID || undefined,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || undefined,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || undefined,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || undefined,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || undefined,
    SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL || undefined,
  }
}

function loadEnv(): Env {
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    const raw = readRawEnv()
    return {
      NODE_ENV:
        raw.NODE_ENV === "production" || raw.NODE_ENV === "test"
          ? raw.NODE_ENV
          : "development",
      DATABASE_URL: raw.DATABASE_URL ?? "",
      BETTER_AUTH_SECRET:
        raw.BETTER_AUTH_SECRET ?? "skip-env-validation-placeholder-secret!!",
      BETTER_AUTH_URL: raw.BETTER_AUTH_URL,
      NEXT_PUBLIC_SITE_URL: raw.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_GA_ID: raw.NEXT_PUBLIC_GA_ID,
      GITHUB_TOKEN: raw.GITHUB_TOKEN,
      GOOGLE_CLIENT_ID: raw.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: raw.GOOGLE_CLIENT_SECRET,
      GITHUB_CLIENT_ID: raw.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: raw.GITHUB_CLIENT_SECRET,
      SHADOW_DATABASE_URL: raw.SHADOW_DATABASE_URL,
    }
  }

  const parsed = envSchema.safeParse(readRawEnv())

  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${formatZodError(parsed.error)}\n\nSee .env.example for required values.`
    )
  }

  // OAuth pairs must be both set or both empty
  const data = parsed.data
  if (Boolean(data.GOOGLE_CLIENT_ID) !== Boolean(data.GOOGLE_CLIENT_SECRET)) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both omitted."
    )
  }
  if (Boolean(data.GITHUB_CLIENT_ID) !== Boolean(data.GITHUB_CLIENT_SECRET)) {
    throw new Error(
      "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must both be set or both omitted."
    )
  }

  return data
}

export const env = loadEnv()
