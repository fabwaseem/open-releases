import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { latestNonDraft } from "../scripts/scrape/github.js"
import { pickReleaseBundle, type RestReleaseInput } from "../scripts/scrape/store.js"

const DAY = 86_400_000
const T0 = Date.parse("2026-10-20T12:00:00Z")
const iso = (t: number) => new Date(t).toISOString()

function rel(
  tag: string,
  publishedAt: number,
  assetNames: string[],
  opts: { id?: number; prerelease?: boolean; draft?: boolean } = {}
): RestReleaseInput {
  return {
    id: opts.id,
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/example/app/releases/tag/${tag}`,
    published_at: iso(publishedAt),
    prerelease: opts.prerelease ?? false,
    draft: opts.draft ?? false,
    body: null,
    assets: assetNames.map((name) => ({
      name,
      size: 1024,
      download_count: 10,
      browser_download_url: `https://github.com/example/app/releases/download/${tag}/${name}`,
    })),
  }
}

const WIN = "app-setup-windows-x64.exe"
const MAC = "app-mac-arm64.dmg"
const LINUX = "app-linux-x86_64.AppImage"

describe("pickReleaseBundle", () => {
  test("merges platform-split releases of the same version", () => {
    const bundle = pickReleaseBundle([
      rel("v2.0.0-windows", T0, [WIN]),
      rel("v2.0.0-mac", T0 - 3_600_000, [MAC]),
      rel("v2.0.0-linux", T0 - 7_200_000, [LINUX]),
    ])
    assert.ok(bundle)
    assert.equal(bundle.primary.tag_name, "v2.0.0-windows")
    assert.equal(bundle.assets.length, 3)
    assert.deepEqual(
      new Set(bundle.assets.map((a) => a.platform)),
      new Set(["windows", "macos", "linux"])
    )
    assert.equal(bundle.usedTags.length, 3)
  })

  test("does not merge an old, different version", () => {
    const bundle = pickReleaseBundle([
      rel("v3.0.0", T0, [WIN]),
      rel("v2.0.0", T0 - 60 * DAY, [MAC]),
    ])
    assert.ok(bundle)
    assert.equal(bundle.primary.tag_name, "v3.0.0")
    assert.equal(bundle.assets.length, 1)
    assert.equal(bundle.assets[0]!.platform, "windows")
  })

  test("merges a nearby release within the 7-day window", () => {
    const bundle = pickReleaseBundle([
      rel("v3.0.1", T0, [WIN]),
      rel("v3.0.0", T0 - 3 * DAY, [MAC]),
    ])
    assert.ok(bundle)
    assert.equal(bundle.assets.length, 2)
    assert.equal(bundle.usedTags.length, 2)
  })

  test("drafts are invisible to the picker", () => {
    const bundle = pickReleaseBundle([
      rel("v9.9.9", T0, [WIN], { draft: true }),
      rel("v1.0.0", T0 - DAY, [MAC]),
    ])
    assert.ok(bundle)
    assert.equal(bundle.primary.tag_name, "v1.0.0")
    assert.equal(pickReleaseBundle([rel("v9.9.9", T0, [WIN], { draft: true })]), null)
  })

  test("releases without usable installers yield null", () => {
    assert.equal(pickReleaseBundle([]), null)
    assert.equal(
      pickReleaseBundle([rel("v1.0.0", T0, ["app-source.zip", "checksums.txt"])]),
      null
    )
  })

  test("stable beats a newer prerelease; prerelease is the fallback", () => {
    const both = pickReleaseBundle([
      rel("v2.1.0-beta", T0, [MAC], { prerelease: true }),
      rel("v2.0.0", T0 - DAY, [WIN]),
    ])
    assert.ok(both)
    assert.equal(both.primary.tag_name, "v2.0.0")

    const preOnly = pickReleaseBundle([
      rel("v2.1.0-beta", T0, [MAC], { prerelease: true }),
      rel("v2.0.0", T0 - DAY, []),
    ])
    assert.ok(preOnly)
    assert.equal(preOnly.primary.tag_name, "v2.1.0-beta")
  })

  test("duplicate asset names across merged releases appear once", () => {
    const bundle = pickReleaseBundle([
      rel("v2.0.0", T0, [WIN]),
      rel("v2.0.0-alt", T0 - 3_600_000, [WIN, MAC]),
    ])
    assert.ok(bundle)
    assert.equal(bundle.assets.filter((a) => a.name === WIN).length, 1)
    assert.equal(bundle.assets.length, 2)
  })
})

describe("latestNonDraft (release-watch watermark compare)", () => {
  test("empty and all-draft lists give null", () => {
    assert.equal(latestNonDraft([]), null)
    assert.equal(
      latestNonDraft([{ id: 1, tag_name: "v1", draft: true }]),
      null
    )
  })

  test("first non-draft wins and the id is stringified", () => {
    const latest = latestNonDraft([
      { id: 9, tag_name: "v3-rc", draft: true, published_at: iso(T0) },
      { id: 8, tag_name: "v2.0.0", published_at: iso(T0 - DAY) },
      { id: 7, tag_name: "v1.0.0", published_at: iso(T0 - 2 * DAY) },
    ])
    assert.deepEqual(latest, {
      githubId: "8",
      tag: "v2.0.0",
      publishedAt: iso(T0 - DAY),
    })
  })
})
