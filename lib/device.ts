import type { Platform, ReleaseAsset } from "@/lib/types"

export type DetectedArch = "arm64" | "x64" | "x86" | "unknown"

export type DetectedDevice = {
  platform: Platform | null
  arch: DetectedArch
  label: string
}

function detectArch(ua: string, platformHint: string): DetectedArch {
  const hay = `${ua} ${platformHint}`.toLowerCase()
  if (
    /arm64|aarch64|apple silicon/.test(hay) ||
    (platformHint.includes("Mac") && /Macintosh/.test(ua) && !/Intel/.test(ua))
  ) {
    // Modern Macs / ARM devices. navigator.userAgentData may be more precise.
    if (/arm|aarch64/.test(hay)) return "arm64"
  }
  if (/arm64|aarch64/.test(hay)) return "arm64"
  if (/wow64|win64|x86_64|amd64|x64/.test(hay)) return "x64"
  if (/i[3-6]86|x86(?!_64)/.test(hay)) return "x86"
  return "unknown"
}

export function detectDevice(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
  platformHint = typeof navigator !== "undefined"
    ? navigator.platform || ""
    : ""
): DetectedDevice {
  const ua = userAgent
  const plat = platformHint
  const hay = `${ua} ${plat}`.toLowerCase()

  let platform: Platform | null = null
  if (/windows|win32|win64|wow64/.test(hay)) platform = "windows"
  else if (/mac os|macintosh|macintel|macppc|mac68k|iphone|ipad|darwin/.test(hay)) {
    // Treat iOS as macOS for download preference is wrong — skip mobile OS.
    if (/iphone|ipad|ipod/.test(hay)) platform = null
    else platform = "macos"
  } else if (/linux|x11|ubuntu|fedora|debian|android/.test(hay)) {
    if (/android/.test(hay)) platform = null
    else platform = "linux"
  }

  // Prefer userAgentData when available (Chromium).
  const uaData = (
    typeof navigator !== "undefined"
      ? (navigator as Navigator & {
          userAgentData?: {
            platform?: string
            getHighEntropyValues?: (hints: string[]) => Promise<{
              architecture?: string
              bitness?: string
              platform?: string
            }>
          }
        }).userAgentData
      : undefined
  )

  if (uaData?.platform) {
    const p = uaData.platform.toLowerCase()
    if (p.includes("windows")) platform = "windows"
    else if (p.includes("mac")) platform = "macos"
    else if (p.includes("linux")) platform = "linux"
  }

  const arch = detectArch(ua, plat)
  const label = platform
    ? `${platform === "macos" ? "macOS" : platform[0]!.toUpperCase() + platform.slice(1)}${
        arch !== "unknown" ? ` (${arch})` : ""
      }`
    : "your device"

  return { platform, arch, label }
}

/** Refine arch asynchronously via Chromium UA-CH when possible. */
export async function refineDeviceArch(
  device: DetectedDevice
): Promise<DetectedDevice> {
  try {
    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<{
            architecture?: string
            bitness?: string
            platform?: string
          }>
        }
      }
    ).userAgentData

    if (!uaData?.getHighEntropyValues) return device

    const values = await uaData.getHighEntropyValues([
      "architecture",
      "bitness",
      "platform",
    ])
    let platform = device.platform
    const p = (values.platform || "").toLowerCase()
    if (p.includes("windows")) platform = "windows"
    else if (p.includes("mac")) platform = "macos"
    else if (p.includes("linux")) platform = "linux"

    let arch = device.arch
    const architecture = (values.architecture || "").toLowerCase()
    if (architecture.includes("arm")) arch = "arm64"
    else if (architecture.includes("x86")) {
      arch = values.bitness === "64" ? "x64" : "x86"
    }

    const label = platform
      ? `${platform === "macos" ? "macOS" : platform[0]!.toUpperCase() + platform.slice(1)}${
          arch !== "unknown" ? ` (${arch})` : ""
        }`
      : device.label

    return { platform, arch, label }
  } catch {
    return device
  }
}

function scoreAsset(asset: ReleaseAsset, device: DetectedDevice): number {
  const name = asset.name.toLowerCase()
  let score = 10

  // Prefer installers over archives/debug.
  if (/\.(exe|msi|msix|dmg|pkg|appimage|deb|rpm)$/.test(name)) score += 40
  if (/\.(zip|tar\.gz|tgz)$/.test(name)) score += 10
  if (/portable|setup|installer|user.?setup/.test(name)) score += 8
  if (/symbol|pdb|dsym|debug|source|src/.test(name)) score -= 100

  if (device.arch === "arm64") {
    if (/arm64|aarch64|apple.?silicon|m1|m2|m3|m4/.test(name)) score += 35
    if (/x64|amd64|x86_64|intel|win32|i686/.test(name) && !/arm64|aarch64/.test(name)) {
      score -= 20
    }
  } else if (device.arch === "x64" || device.arch === "unknown") {
    if (/x64|amd64|x86_64|win64|intel/.test(name)) score += 25
    if (/arm64|aarch64/.test(name) && !/universal/.test(name)) score -= 15
  } else if (device.arch === "x86") {
    if (/x86(?!_64)|i686|win32|ia32/.test(name)) score += 25
    if (/x64|amd64|arm64/.test(name)) score -= 15
  }

  if (/universal/.test(name) && device.platform === "macos") score += 20

  // Prefer higher download counts slightly (popular = safer default).
  score += Math.min(Math.log10((asset.download_count ?? 0) + 1) * 2, 8)

  return score
}

export function pickBestDownload(
  assets: ReleaseAsset[],
  device: DetectedDevice
): ReleaseAsset | null {
  if (!device.platform) return null
  const candidates = assets.filter((a) => a.platform === device.platform)
  if (!candidates.length) return null

  return [...candidates].sort(
    (a, b) => scoreAsset(b, device) - scoreAsset(a, device)
  )[0] ?? null
}