/**
 * Heuristics for CLI / server / infra tools that aren't end-user apps.
 * Used by scrape, import, and the purge script.
 *
 * Seed examples: grafana, uv, traefik, sing-box, PostHog, codegraph, rtk.
 */

export const SKIPPED_NON_APP_STATUS = "skipped_non_app"
export const SKIPPED_NON_APP_REASON = "non-app (cli/server/infra)"

type AssetLike = { name?: string }

/** Consumer GUI / mobile installers — presence keeps the repo. */
const GUI_INSTALLER =
  /\.(exe|msi|msix|appx|dmg|appimage|apk|aab|ipa|hap)(\.|$)/i
const SERVER_PKG = /\.(deb|rpm)(\.|$)/i
const META_ASSET =
  /\.(sha256|sha512|sig|asc|pem|yml|yaml|json|txt|sbom|blockmap|zsync)$/i
const RUST_TRIPLE =
  /(unknown-linux|apple-darwin|pc-windows-msvc|pc-windows-gnu|-musl)/i
const GO_OS_ARCH = /_(linux|darwin)_(amd64|arm64|386|armv[0-9])/i
const CLI_IN_NAME = /(-cli|_cli|(^|\/)cli$)/i

const INFRA_TOPIC =
  /^(kubernetes|k8s|docker|prometheus|grafana|monitoring|observability|devops|infrastructure|reverse-proxy|load-balancer|microservice|etcd|consul|terraform|ansible|proxy|vpn|tunnel|self-hosted|sdk|library|cli|command-line|command-line-tool|developer-tools|packaging|package-manager|cdn|mcp|agentic-coding|terminal)$/i

const INFRA_DESC =
  /\b(cli|command[- ]line|command line tool|terminal ui|proxy platform|load[- ]balancer|kubernetes|docker|observability|prometheus|reverse proxy|package manager|project manager|sdk|daemon|self[- ]hosted|infrastructure|devops|api gateway|telemetry|binary releases?|single binary|knowledge graph|developer platform|product analytics)\b/i

/** Archive-only tools that are still normal end-user apps. */
const CONSUMER_KEEP_DESC =
  /\b(android device|display and control|file synchronization|screen mirroring|mirror(ing)? your|password manager|note[- ]taking|media player|video player|music player|image editor|photo editor|torrent client)\b/i

const CONSUMER_KEEP_TOPIC =
  /^(sdl2|mirroring|synchronization|peer-to-peer|p2p|password-manager|video-player|music-player)$/i

export type NonAppInput = {
  fullName: string
  name: string
  description?: string | null
  topics?: unknown
  hasWindows: boolean
  hasMacos: boolean
  hasLinux: boolean
  hasAndroid: boolean
  hasIos: boolean
  /** Release asset list (objects with `name`, or plain name strings). */
  assets: unknown
  id?: string
  platforms?: unknown
  stars?: number
}

export type NonAppMatch = {
  id?: string
  fullName: string
  name: string
  description: string | null
  platforms: string[]
  stars: number
  reasons: string[]
  rules: string[]
  sampleAssets: string[]
}

function installerNames(assets: unknown): string[] {
  if (!Array.isArray(assets)) return []
  return assets
    .map((a) => {
      if (typeof a === "string") return a
      if (a && typeof a === "object" && "name" in a) {
        return String((a as AssetLike).name ?? "")
      }
      return ""
    })
    .filter((n) => n && !META_ASSET.test(n))
}

/** Returns a match object when the repo looks like a non-app; otherwise null. */
export function evaluateNonApp(input: NonAppInput): NonAppMatch | null {
  const installers = installerNames(input.assets)
  if (installers.length === 0) return null

  const topics = Array.isArray(input.topics) ? (input.topics as string[]) : []
  const platforms = Array.isArray(input.platforms)
    ? (input.platforms as string[])
    : []
  const desc = input.description ?? ""

  const hasGui = installers.some((n) => GUI_INSTALLER.test(n))
  const serverCount = installers.filter((n) => SERVER_PKG.test(n)).length
  const rustCount = installers.filter((n) => RUST_TRIPLE.test(n)).length
  const goCount = installers.filter((n) => GO_OS_ARCH.test(n)).length

  const noConsumerPlatform =
    !input.hasWindows && !input.hasAndroid && !input.hasIos

  if (!noConsumerPlatform || hasGui) return null

  const consumerKeep =
    CONSUMER_KEEP_DESC.test(desc) ||
    topics.some((t) => CONSUMER_KEEP_TOPIC.test(t))
  if (consumerKeep) return null

  const reasons: string[] = ["no-windows/android/ios", "no-gui-installers"]
  if (serverCount >= 2) reasons.push("deb/rpm-heavy")
  if (rustCount >= 2) reasons.push("rust-cli-triples")
  if (goCount >= 2) reasons.push("go-os-arch-bins")
  if (topics.some((t) => INFRA_TOPIC.test(t))) reasons.push("infra/cli-topic")
  if (INFRA_DESC.test(desc)) reasons.push("infra/cli-description")
  if (CLI_IN_NAME.test(input.name) || CLI_IN_NAME.test(input.fullName)) {
    reasons.push("cli-in-name")
  }

  const linuxServerOnly =
    input.hasLinux &&
    !input.hasWindows &&
    !input.hasMacos &&
    !input.hasAndroid &&
    !input.hasIos
  if (linuxServerOnly) reasons.push("linux-server-only")

  const cliPackaging = rustCount >= 2 || goCount >= 2 || serverCount >= 2
  const semantic =
    reasons.includes("infra/cli-topic") ||
    reasons.includes("infra/cli-description") ||
    reasons.includes("cli-in-name")

  const rulePackaging = cliPackaging
  const ruleSemantic = semantic
  const ruleLinuxOnly = linuxServerOnly

  if (!(rulePackaging || ruleSemantic || ruleLinuxOnly)) return null

  const rules = [
    rulePackaging && "packaging:cli-or-server-bins",
    ruleSemantic && "semantic:cli/infra-copy",
    ruleLinuxOnly && "platform:linux-server-only",
  ].filter(Boolean) as string[]

  return {
    id: input.id,
    fullName: input.fullName,
    name: input.name,
    description: input.description ?? null,
    platforms,
    stars: input.stars ?? 0,
    reasons,
    rules,
    sampleAssets: installers.slice(0, 8),
  }
}

export function isNonApp(input: NonAppInput): boolean {
  return evaluateNonApp(input) != null
}

export function nonAppErrorMessage(match?: NonAppMatch | null): string {
  const detail = match?.reasons?.length
    ? ` (${match.reasons.slice(0, 3).join(", ")})`
    : ""
  return `Skipped non-app / CLI-server tool${detail}`
}
