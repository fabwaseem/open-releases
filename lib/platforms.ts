export type Platform = "windows" | "macos" | "linux" | "android" | "ios"

export const ALL_PLATFORMS: readonly Platform[] = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
] as const

export function isPlatform(value: string): value is Platform {
  return (ALL_PLATFORMS as readonly string[]).includes(value)
}

/** Installer / app package heuristics for catalog releases. */
const ASSET_RULES: Array<{ platform: Platform; re: RegExp }> = [
  // Android before linux — APK/AAB must not fall through as archives.
  {
    platform: "android",
    re: /(\.apk$|\.aab$|[-_.](android|android-arm64|android-arm|android-x86|android-x86_64|armeabi-v7a|arm64-v8a)([-_.].*)?\.(apk|aab|zip)$)/i,
  },
  // iOS IPA packages (+ common naming).
  {
    platform: "ios",
    re: /(\.ipa$|[-_.](ios|iphone|ipad|apple-ios)([-_.].*)?\.(ipa|zip)$)/i,
  },
  { platform: "windows", re: /\.(exe|msi|msix|msixbundle|appx)$/i },
  {
    platform: "macos",
    re: /(\.dmg$|\.pkg$|[-_.](mac|macos|osx|darwin|apple-darwin|darwin-amd64|darwin-arm64|darwin-universal|macos-amd64|macos-arm64|macos-universal)([-_.].*)?\.(zip|tar\.gz|tgz)$)/i,
  },
  {
    platform: "linux",
    re: /(\.AppImage$|\.deb$|\.rpm$|\.snap$|\.flatpak$|[-_.](linux|ubuntu|debian|fedora|linux-amd64|linux-x86_64|linux-arm64|linux-aarch64|linux-armv7|linux-armhf|unknown-linux)([-_.].*)?\.(AppImage|deb|rpm|snap|flatpak|tar\.gz|tgz|zip)$)/i,
  },
]

const SKIP =
  /(\.(pdb|dSYM|dSYMs)(\.|$)|[-_.](pdb|dsym|dbsym|symbols?)([-_.]|$)|[-_.](source|src|sources)([-_.]|$)|(^|[-_.])(source|src|sources)(\.|$))/i

/** @deprecated Prefer ReleaseAsset — kept for scrape/ingest call sites. */
export type DesktopAsset = {
  name: string
  platform: Platform
  size: number | null
  download_count: number | null
  url: string
}

export type ReleaseAssetDetected = DesktopAsset

export type PlatformSummary = {
  platforms: Platform[]
  hasWindows: boolean
  hasMacos: boolean
  hasLinux: boolean
  hasAndroid: boolean
  hasIos: boolean
}

export function detectPlatformsFromName(name: string): Platform[] {
  if (SKIP.test(name)) return []
  return ASSET_RULES.filter((r) => r.re.test(name)).map((r) => r.platform)
}

/** Keep installable Win/Mac/Linux/Android/iOS packages from a GitHub release. */
export function filterDesktopAssets(
  assets: Array<{
    name?: string
    size?: number | null
    download_count?: number | null
    downloadCount?: number | null
    url?: string | null
    browser_download_url?: string | null
    downloadUrl?: string | null
  }>
): DesktopAsset[] {
  const out: DesktopAsset[] = []
  for (const asset of assets) {
    const name = asset.name ?? ""
    const platforms = detectPlatformsFromName(name)
    if (!platforms.length) continue
    const url =
      asset.downloadUrl || asset.browser_download_url || asset.url || ""
    if (!url) continue
    out.push({
      name,
      platform: platforms[0]!,
      size: asset.size ?? null,
      download_count: asset.downloadCount ?? asset.download_count ?? null,
      url,
    })
  }
  return out
}

/** Alias — same as filterDesktopAssets (includes mobile). */
export const filterReleaseAssets = filterDesktopAssets

export function summarizePlatforms(assets: DesktopAsset[]): PlatformSummary {
  const platforms = [...new Set(assets.map((a) => a.platform))]
  return {
    platforms,
    hasWindows: platforms.includes("windows"),
    hasMacos: platforms.includes("macos"),
    hasLinux: platforms.includes("linux"),
    hasAndroid: platforms.includes("android"),
    hasIos: platforms.includes("ios"),
  }
}

/** Prisma create/update field bag for platform flags. */
export function platformFlagFields(summary: PlatformSummary) {
  return {
    platforms: summary.platforms,
    hasWindows: summary.hasWindows,
    hasMacos: summary.hasMacos,
    hasLinux: summary.hasLinux,
    hasAndroid: summary.hasAndroid,
    hasIos: summary.hasIos,
  }
}
