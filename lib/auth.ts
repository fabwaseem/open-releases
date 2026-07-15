import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { admin } from "better-auth/plugins"

import { prisma } from "@/lib/db"
import { env } from "@/lib/env"

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  user: {
    additionalFields: {},
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    nextCookies(),
  ],
  trustedOrigins: [env.BETTER_AUTH_URL ?? "http://localhost:3000"].filter(
    Boolean
  ),
})

export type Session = typeof auth.$Infer.Session
