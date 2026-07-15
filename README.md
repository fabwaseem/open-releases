# Open Releases

A living directory of open-source **Windows, macOS, and Linux** desktop apps that ship real installers on GitHub Releases.

**Live:** [https://open-releases.vercel.app](https://open-releases.vercel.app)

## Product

- Browse and search curated desktop apps from GitHub
- Filter by platform, language, and sort
- Save favorites (signed-in users)
- Submit repos for inclusion; admins publish instantly
- Feature pinning for highlighted apps

## Stack

Next.js, Prisma, Postgres, better-auth, TanStack Query, Tailwind, shadcn/ui.

## Setup

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL, BETTER_AUTH_*, OAuth, GITHUB_TOKEN
# Production SEO/canonical:
# NEXT_PUBLIC_SITE_URL=https://open-releases.vercel.app
pnpm db:push
pnpm dev
```

Scrape catalog entries:

```bash
pnpm scrape -- --query downloader --max-repos 50
```

## Brand & SEO

Copy and SEO defaults live in `lib/brand.ts` and `lib/seo.ts`.
Sitemap: `/sitemap.xml` · Robots: `/robots.txt`
