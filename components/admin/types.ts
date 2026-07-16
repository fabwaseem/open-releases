export type AdminStats = {
  totals: {
    repositories: number
    visibleRepos: number
    hiddenRepos: number
    users: number
    admins: number
    bannedUsers: number
    favorites: number
    pendingSubmissions: number
    platforms: {
      windows: number
      macos: number
      linux: number
      android: number
      ios: number
    }
  }
  scrapeByStatus: { status: string; count: number }[]
  topLanguages: { name: string; count: number }[]
  recentRepos: Array<{
    id: string
    fullName: string
    stars: number
    activityScore: number
    scrapedAt: string
  }>
  recentUsers: Array<{
    id: string
    name: string
    email: string
    role: string
    banned: boolean
    createdAt: string
  }>
}

export type AdminRepo = {
  id: string
  fullName: string
  name: string
  owner: string
  stars: number
  activityScore: number
  language: string | null
  hidden: boolean
  hiddenReason: string | null
  featured: boolean
  featuredAt: string | null
  scrapedAt: string
  createdAt: string
  hasWindows: boolean
  hasMacos: boolean
  hasLinux: boolean
  hasAndroid: boolean
  hasIos: boolean
  _count: { favorites: number }
}

export type AdminUser = {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean
  banReason: string | null
  emailVerified: boolean
  createdAt: string
  image: string | null
  _count: { favorites: number }
}

export type AdminListResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  sortBy: string
  sortDir: "asc" | "desc"
}
