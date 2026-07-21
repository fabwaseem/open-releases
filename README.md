# Open Releases

[Open Releases](https://open-releases.vercel.app) is a living directory of
open-source applications distributed through GitHub Releases. It helps people
find useful software and download the correct installer for Windows, macOS,
Linux, Android, or iOS without digging through release pages.

The catalog is continuously refreshed from GitHub. Repositories must have a
usable installer or application package; libraries, source-only projects,
server software, and CLI-only tools are excluded.

## Features

- Search and browse curated open-source applications.
- Filter releases by the current device or a selected platform.
- Sort by activity score, release date, stars, or name in either direction.
- Open a high-scoring random application with **Surprise me**.
- View repository metadata, README content, release notes, screenshots, and
  platform-specific downloads.
- Save favorites after signing in.
- Submit GitHub repositories for admin review.
- Review submissions, manage users, hide entries, and feature selected apps
  from the admin dashboard.
- Automatically discover new projects and refresh existing catalog entries
  through GitHub Actions.

## How the catalog works

The scraper searches GitHub for active and recently created repositories, then
checks each candidate's releases. A repository is published only when it has at
least one recognized application package, such as `.exe`, `.msi`, `.dmg`,
`.pkg`, `.AppImage`, `.deb`, `.rpm`, `.apk`, or `.ipa`.

Every repository receives an activity score based on signals such as release
recency and frequency, star momentum, recent commits, contributor growth, and
issue activity. New projects receive a temporary discovery boost, while
stagnant projects gradually decay in rank. The score is recalculated whenever
the repository is refreshed.

`ScrapeRecord` acts as a discovery ledger. It remembers saved, rejected, and
failed candidates so repeated discovery runs do not waste GitHub API requests
on known repositories.

## Technology

- Next.js 16 with the App Router and React 19
- TypeScript
- PostgreSQL with Prisma 7 and the PostgreSQL driver adapter
- better-auth with password, Google, and GitHub authentication
- TanStack Query
- Tailwind CSS and shadcn/ui
- GitHub REST API for discovery, repository metadata, releases, and activity
- GitHub Actions for scheduled production scraping
- Vercel for application hosting

## Project structure

```text
app/                 Next.js pages, layouts, and API routes
components/          Directory, repository, admin, and shared UI
lib/                 Catalog queries, auth, scoring, ingestion, and utilities
prisma/              Database schema and migrations
scripts/scrape/      GitHub discovery and catalog refresh CLI
scripts/             Imports, cleanup, icon generation, and DB migration tools
.github/workflows/   Scheduled update and discovery jobs
```

## Local development

### Requirements

- Node.js 20 or newer
- pnpm 9
- PostgreSQL
- A GitHub personal access token for reliable API limits

### Installation

```bash
git clone https://github.com/fabwaseem/open-releases.git
cd open-releases
pnpm install
```

Copy `.env.example` to `.env` and configure the required values:

```bash
cp .env.example .env
```

Required variables:

- `DATABASE_URL` — PostgreSQL connection string used by the app and scraper.
- `BETTER_AUTH_SECRET` — random secret of at least 32 characters.
- `BETTER_AUTH_URL` — local or deployed application URL.
- `GITHUB_TOKEN` — token used for scraping and repository previews.

Optional variables:

- `NEXT_PUBLIC_SITE_URL` — canonical production URL used by SEO metadata.
- `NEXT_PUBLIC_GA_ID` — Google Analytics 4 measurement ID.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — Google OAuth credentials.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` — GitHub OAuth credentials.
- `SHADOW_DATABASE_URL` — isolated database used for migration development.

OAuth client IDs and secrets must always be configured as complete pairs.

### Database

To use Prisma's local development database:

```bash
pnpm db:dev
pnpm db:push
```

To use an existing PostgreSQL server, set `DATABASE_URL` in `.env`, then run:

```bash
pnpm db:push
pnpm db:generate
```

Open Prisma Studio with:

```bash
pnpm db:studio
```

Start the application:

```bash
pnpm dev
```

The local site is available at [http://localhost:3000](http://localhost:3000).

## Scraping

The scraper writes directly to the database configured by `DATABASE_URL`.
Always confirm which database the variable points to before running a command.

Discover and ingest new repositories:

```bash
pnpm scrape
pnpm scrape -- --min-stars 20 --max-repos 300
pnpm scrape -- --query "stars:>100 language:TypeScript archived:false"
```

Useful discovery options:

- `--max-repos N` — stop after saving N new repositories; `0` is unlimited.
- `--min-stars N` — minimum star count for generated discovery queries.
- `--query "..."` — append custom GitHub repository search qualifiers.
- `--pushed-after YYYY-MM-DD` — ignore repositories without recent pushes.
- `--discovery api|html` — choose authenticated API or HTML discovery.

Refresh existing entries, release information, and scores:

```bash
pnpm scrape:update
pnpm scrape:update -- --max-repos 500
pnpm scrape:update -- --stale-days 7 --max-repos 500
```

Update mode processes the stalest entries first. Repositories that were
deleted, became private, no longer have usable installers, or are classified as
non-app projects are removed from the public catalog.

Additional maintenance commands:

```bash
pnpm scrape:lists       # Import candidates from configured awesome lists
pnpm hide:non-apps      # Re-evaluate and hide non-application entries
pnpm import:links       # Import repository links
pnpm icons              # Regenerate application icons
```

## Scheduled scraping with GitHub Actions

Production scraping runs directly against PostgreSQL from GitHub Actions. It
does not call a Vercel API route, so it is unaffected by Vercel Hobby's
once-per-day cron restriction and 60-second function limit.

Add these repository secrets under **Settings → Secrets and variables →
Actions**:

- `DATABASE_URL` — the production PostgreSQL/Neon connection string.
- `SCRAPE_GITHUB_TOKEN` — a GitHub token used only by the scraper. Public
  repository read access is sufficient.

The included workflows are:

- `scrape-update.yml` — refreshes up to 500 stale catalog entries every six
  hours.
- `scrape-discover.yml` — discovers up to 300 new repositories daily at
  03:00 UTC.

Both workflows support manual execution from the repository's **Actions** tab.
Manual runs expose inputs for changing repository limits, stale age, and
minimum stars. Concurrency controls prevent two copies of the same scraper from
writing simultaneously.

Dependencies are installed with `--ignore-scripts` in Actions so scheduled
scrapes cannot implicitly run database migrations. The Prisma client is
generated explicitly before each scrape.

## Production database migration

The migration utility copies local scrape results into production using bulk
PostgreSQL upserts:

```bash
pnpm db:migrate-scrape -- --dry-run
pnpm db:migrate-scrape -- --confirm
```

Configure `LOCAL_DATABASE_URL` and `PROD_DATABASE_URL` before using it. The
script synchronizes repositories and releases while preserving production
admin state such as hidden and featured entries. Always run the dry run first.

## Deployment

The web application can be deployed to Vercel with the variables documented in
`.env.example`. Set production OAuth callback URLs to:

```text
https://your-domain.example/api/auth/callback/google
https://your-domain.example/api/auth/callback/github
```

Database migrations are deployed by the `postinstall` command. Scheduled
scraping remains in GitHub Actions and requires no Vercel Cron configuration.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

## Brand and SEO

Brand copy and SEO defaults live in `lib/brand.ts` and `lib/seo.ts`.

- Sitemap: `/sitemap.xml`
- Robots: `/robots.txt`
- Privacy policy: `/privacy`
- Terms: `/terms`
