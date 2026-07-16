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

/** Non-installers: signatures, checksums, debug symbols, sources, UI scripts. */
const SKIP =
  /(\.(sig|asc|pem|blockmap|sha256|sha512|sha1|md5|sbom|zsync)(\.|$)|checksums?|sums\.txt|[-_.](pdb|dsym|dbsym|symbols?)([-_.]|$)|[-_.](source|src|sources)([-_.]|$)|(^|[-_.])(source|src|sources)(\.|$)|\.sh$)/i

/** Server/embedded arches most desktop users never need. */
const NICHE_ARCH =
  /(mips|mips64|mipsle|mips64le|ppc64|ppc64le|powerpc|riscv|s390x|loong|sparc|alpha|softfloat)/i

const PRIMARY_INSTALLER =
  /\.(exe|msi|msix|msixbundle|appx|dmg|pkg|appimage|deb|rpm|snap|flatpak|apk|aab|ipa)$/i

const ARCHIVE = /\.(zip|tar\.gz|tgz|tar\.xz|tar\.bz2)$/i

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

type ArchBucket = "arm64" | "x64" | "x86" | "universal" | "other"

function archBucket(name: string): ArchBucket {
  const n = name.toLowerCase()
  if (NICHE_ARCH.test(n)) return "other"
  if (/universal|universal-apple|fat-/.test(n)) return "universal"
  if (/arm64|aarch64|apple.?silicon|darwin-arm/.test(n)) return "arm64"
  if (/armv\d|armhf|armeabi|arm-/.test(n) && !/arm64|aarch64/.test(n)) {
    return "other"
  }
  if (/x86_64|amd64|x64|win64|darwin-amd64|intel/.test(n)) return "x64"
  if (/(^|[^a-z])(i[3-6]86|ia32|win32)([^a-z]|$)|x86(?!_64)/.test(n)) {
    return "x86"
  }
  // Unspecified arch on a primary installer → treat as mainstream x64.
  if (PRIMARY_INSTALLER.test(n)) return "x64"
  return "other"
}

function installerRank(name: string): number {
  const n = name.toLowerCase()
  if (/\.(dmg|pkg|exe|msi|appimage|apk|ipa)$/.test(n)) return 100
  if (/\.(deb|rpm|msix|appx|snap|flatpak|aab)$/.test(n)) return 90
  if (ARCHIVE.test(n)) return 40
  return 10
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

/**
 * Narrow a release’s assets to what a normal user should pick:
 * mainstream arches + real installers; drop niche CPU builds and
 * raw archives when a proper package exists for the same arch.
 */
export function curateDownloadAssets<T extends DesktopAsset>(assets: T[]): T[] {
  const usable = assets.filter((asset) => {
    const name = asset.name
    if (SKIP.test(name)) return false
    if (NICHE_ARCH.test(name)) return false
    const arch = archBucket(name)
    // Keep universal / x64 / arm64; drop obscure and 32-bit unless Windows.
    if (arch === "other") return false
    if (arch === "x86" && asset.platform !== "windows") return false
    return true
  })

  const byKey = new Map<string, T[]>()
  for (const asset of usable) {
    const key = `${asset.platform}:${archBucket(asset.name)}`
    const list = byKey.get(key) ?? []
    list.push(asset)
    byKey.set(key, list)
  }

  const curated: T[] = []
  for (const group of byKey.values()) {
    const primaries = group.filter((a) => PRIMARY_INSTALLER.test(a.name))
    const chosen = primaries.length > 0 ? primaries : group
    curated.push(
      ...[...chosen].sort(
        (a, b) =>
          installerRank(b.name) - installerRank(a.name) ||
          (b.download_count ?? 0) - (a.download_count ?? 0)
      )
    )
  }

  return curated.sort((a, b) => a.name.localeCompare(b.name))
}

/** Alias — same as filterDesktopAssets (includes mobile). */
export const filterReleaseAssets = filterDesktopAssets

/**
 * Assets a visitor should actually see: platform-matched, then curated
 * (mainstream arches + real installers). Empty ⇒ not a directory app.
 */
export function usableInstallers(
  assets: Array<{
    name?: string
    size?: number | null
    download_count?: number | null
    downloadCount?: number | null
    url?: string | null
    browser_download_url?: string | null
    downloadUrl?: string | null
    platform?: string
  }>
): DesktopAsset[] {
  return curateDownloadAssets(filterDesktopAssets(assets))
}

export function hasUsableInstallers(assets: unknown): boolean {
  if (!Array.isArray(assets) || assets.length === 0) return false
  return usableInstallers(assets as Parameters<typeof usableInstallers>[0]).length > 0
}

export const SKIPPED_NO_ASSETS_STATUS = "skipped_no_assets"
export const SKIPPED_NO_ASSETS_REASON = "no installable release assets"

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
