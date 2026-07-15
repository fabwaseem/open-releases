import "dotenv/config"
import { defineConfig, env } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // Used only by migrate diff / migrate dev — never touches app data.
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ??
      "postgresql://postgres:root@localhost:5432/prisma_migrate_shadow?sslmode=disable",
  },
})