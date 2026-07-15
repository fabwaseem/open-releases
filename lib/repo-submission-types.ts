import type { DesktopAsset, Platform } from "@/lib/platforms"

export type RepoPreview = {
  fullName: string
  sourceUrl: string
  name: string
  owner: string
  description: string | null
  url: string
  homepage: string | null
  stars: number
  language: string | null
  avatarUrl: string | null
  license: string | null
  releaseTag: string
  releaseName: string | null
  releaseUrl: string | null
  publishedAt: string | null
  prerelease: boolean
  platforms: Platform[]
  assets: DesktopAsset[]
}
