import type { MetadataRoute } from "next"

import { siteConfig } from "@/lib/brand"
import { prisma } from "@/lib/db"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: siteConfig.url,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${siteConfig.url}/privacy`,
      lastModified: new Date("2026-07-15"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteConfig.url}/terms`,
      lastModified: new Date("2026-07-15"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ]

  try {
    const repos = await prisma.repository.findMany({
      where: { hidden: false },
      select: {
        owner: true,
        name: true,
        updatedAt: true,
      },
      orderBy: { activityScore: "desc" },
      take: 5000,
    })

    const repoRoutes: MetadataRoute.Sitemap = repos.map((repo) => ({
      url: `${siteConfig.url}/repo/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
      lastModified: repo.updatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    }))

    return [...staticRoutes, ...repoRoutes]
  } catch {
    return staticRoutes
  }
}
