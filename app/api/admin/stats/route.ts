import { prisma } from "@/lib/db"
import { getSession, isAdminRole } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminRole(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const [
    repositories,
    visibleRepos,
    hiddenRepos,
    users,
    admins,
    bannedUsers,
    favorites,
    pendingSubmissions,
    scrapeByStatus,
    topLanguages,
    recentRepos,
    recentUsers,
  ] = await Promise.all([
    prisma.repository.count(),
    prisma.repository.count({ where: { hidden: false, latestRelease: { isNot: null } } }),
    prisma.repository.count({ where: { hidden: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: "admin" } }),
    prisma.user.count({ where: { banned: true } }),
    prisma.favorite.count(),
    prisma.repoSubmission.count({ where: { status: "pending" } }),
    prisma.scrapeRecord.groupBy({
      by: ["status"],
      _count: { status: true },
      orderBy: { _count: { status: "desc" } },
    }),
    prisma.repository.groupBy({
      by: ["language"],
      where: { hidden: false, language: { not: null } },
      _count: { language: true },
      orderBy: { _count: { language: "desc" } },
      take: 8,
    }),
    prisma.repository.findMany({
      where: { hidden: false },
      orderBy: { scrapedAt: "desc" },
      take: 6,
      select: {
        id: true,
        fullName: true,
        stars: true,
        activityScore: true,
        scrapedAt: true,
        hasWindows: true,
        hasMacos: true,
        hasLinux: true,
        hasAndroid: true,
        hasIos: true,
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        createdAt: true,
      },
    }),
  ])

  const [windows, macos, linux, android, ios] = await Promise.all([
    prisma.repository.count({
      where: { hidden: false, hasWindows: true, latestRelease: { isNot: null } },
    }),
    prisma.repository.count({
      where: { hidden: false, hasMacos: true, latestRelease: { isNot: null } },
    }),
    prisma.repository.count({
      where: { hidden: false, hasLinux: true, latestRelease: { isNot: null } },
    }),
    prisma.repository.count({
      where: {
        hidden: false,
        hasAndroid: true,
        latestRelease: { isNot: null },
      },
    }),
    prisma.repository.count({
      where: { hidden: false, hasIos: true, latestRelease: { isNot: null } },
    }),
  ])

  return Response.json({
    totals: {
      repositories,
      visibleRepos,
      hiddenRepos,
      users,
      admins,
      bannedUsers,
      favorites,
      pendingSubmissions,
      platforms: { windows, macos, linux, android, ios },
    },
    scrapeByStatus: scrapeByStatus.map((s) => ({
      status: s.status,
      count: s._count.status,
    })),
    topLanguages: topLanguages
      .filter((l) => l.language)
      .map((l) => ({ name: l.language!, count: l._count.language })),
    recentRepos,
    recentUsers,
  })
}
