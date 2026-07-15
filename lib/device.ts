import { platformLabel } from "@/lib/format"
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
    if (/arm|aarch64/.test(hay)) return "arm64"
  }
  if (/arm64|aarch64/.test(hay)) return "arm64"
  if (/wow64|win64|x86_64|amd64|x64/.test(hay)) return "x64"
  if (/i[3-6]86|x86(?!_64)/.test(hay)) return "x86"
  return "unknown"
}

function deviceLabel(platform: Platform | null, arch: DetectedArch): string {
  if (!platform) return "your device"
  const name = platformLabel(platform)
  return arch !== "unknown" ? `${name} (${arch})` : name
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
  if (/iphone|ipad|ipod/.test(hay)) platform = "ios"
  else if (/android/.test(hay)) platform = "android"
  else if (/windows|win32|win64|wow64/.test(hay)) platform = "windows"
  else if (/mac os|macintosh|macintel|macppc|mac68k|darwin/.test(hay)) {
    platform = "macos"
  } else if (/linux|x11|ubuntu|fedora|debian/.test(hay)) {
    platform = "linux"
  }

  const uaData = (
    typeof navigator !== "undefined"
      ? (
          navigator as Navigator & {
            userAgentData?: {
              platform?: string
              mobile?: boolean
              getHighEntropyValues?: (hints: string[]) => Promise<{
                architecture?: string
                bitness?: string
                platform?: string
              }>
            }
          }
        ).userAgentData
      : undefined
  )

  if (uaData?.platform && !platform) {
    const p = uaData.platform.toLowerCase()
    if (p.includes("android")) platform = "android"
    else if (p.includes("windows")) platform = "windows"
    else if (p.includes("mac")) platform = "macos"
    else if (p.includes("linux")) platform = "linux"
  }

  const arch = detectArch(ua, plat)
  return { platform, arch, label: deviceLabel(platform, arch) }
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
    // Don't override an already-detected mobile platform from UA string.
    if (!platform || platform === "windows" || platform === "macos" || platform === "linux") {
      if (p.includes("android")) platform = "android"
      else if (p.includes("windows")) platform = "windows"
      else if (p.includes("mac")) platform = "macos"
      else if (p.includes("linux")) platform = "linux"
    }

    let arch = device.arch
    const architecture = (values.architecture || "").toLowerCase()
    if (architecture.includes("arm")) arch = "arm64"
    else if (architecture.includes("x86")) {
      arch = values.bitness === "64" ? "x64" : "x86"
    }

    return { platform, arch, label: deviceLabel(platform, arch) }
  } catch {
    return device
  }
}

function scoreAsset(asset: ReleaseAsset, device: DetectedDevice): number {
  const name = asset.name.toLowerCase()
  let score = 10

  if (/\.(exe|msi|msix|dmg|pkg|appimage|deb|rpm|apk|aab|ipa)$/.test(name)) {
    score += 40
  }
  if (/\.(zip|tar\.gz|tgz)$/.test(name)) score += 10
  if (/portable|setup|installer|user.?setup/.test(name)) score += 8
  if (/symbol|pdb|dsym|debug|source|src/.test(name)) score -= 100

  if (device.platform === "android") {
    if (/\.apk$/.test(name)) score += 30
    if (/\.aab$/.test(name)) score += 10
    if (/arm64|aarch64|arm64-v8a/.test(name)) score += 20
  } else if (device.platform === "ios") {
    if (/\.ipa$/.test(name)) score += 35
  } else if (device.arch === "arm64") {
    if (/arm64|aarch64|apple.?silicon|m1|m2|m3|m4/.test(name)) score += 35
    if (
      /x64|amd64|x86_64|intel|win32|i686/.test(name) &&
      !/arm64|aarch64/.test(name)
    ) {
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

  return (
    [...candidates].sort(
      (a, b) => scoreAsset(b, device) - scoreAsset(a, device)
    )[0] ?? null
  )
}
