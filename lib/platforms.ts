export type Platform = "windows" | "macos" | "linux"

const DESKTOP_RULES: Array<{ platform: Platform; re: RegExp }> = [
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

export type DesktopAsset = {
  name: string
  platform: Platform
  size: number | null
  download_count: number | null
  url: string
}

export function detectPlatformsFromName(name: string): Platform[] {
  if (SKIP.test(name)) return []
  return DESKTOP_RULES.filter((r) => r.re.test(name)).map((r) => r.platform)
}

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

export function summarizePlatforms(assets: DesktopAsset[]) {
  const platforms = [...new Set(assets.map((a) => a.platform))]
  return {
    platforms,
    hasWindows: platforms.includes("windows"),
    hasMacos: platforms.includes("macos"),
    hasLinux: platforms.includes("linux"),
  }
}