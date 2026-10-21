#!/usr/bin/env node
/**
 * Vercel build entrypoint (package.json: "vercel-build").
 *
 * Production deployments migrate automatically — there is no manual
 * "DB · migrate production" workflow anymore:
 *
 *   VERCEL_ENV=production  -> prisma migrate deploy && prisma generate && next build
 *   VERCEL_ENV=preview/dev -> prisma generate && next build   (no migration)
 *
 * Preview deployments share the production DATABASE_URL on Vercel, so
 * migrating there would change the live schema before the branch is merged.
 * A failed migration fails the build, so a bad migration never goes live
 * silently — fix the migration and redeploy.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";

const binDir = join(process.cwd(), "node_modules", ".bin");
const env = {
  ...process.env,
  PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
};

function run(command) {
  console.log(`\n$ ${command}`);
  execSync(command, { stdio: "inherit", env });
}

const isVercel = process.env.VERCEL === "1";
const vercelEnv = process.env.VERCEL_ENV; // "production" | "preview" | "development"
const isProductionDeploy = !isVercel || vercelEnv === "production";

if (isProductionDeploy) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set — cannot run production migrations. " +
        "Set it in Vercel → Settings → Environment Variables (Production).",
    );
  }
  run("prisma migrate deploy");
} else {
  console.log(
    `Skipping prisma migrate deploy for VERCEL_ENV=${vercelEnv} — ` +
      "migrations run only on production deployments.",
  );
}

run("prisma generate");
run("next build");
