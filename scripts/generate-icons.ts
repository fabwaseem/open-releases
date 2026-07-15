/**
 * Generate favicon + PWA PNG icons from the Open Releases SVG logo.
 *
 * Usage: pnpm icons
 */
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"
import toIco from "to-ico"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")

const SOURCE_SVG = path.join(root, "assets/brand/logo.svg")
const PUBLIC_DIR = path.join(root, "public")
const ICONS_DIR = path.join(PUBLIC_DIR, "icons")
const APP_DIR = path.join(root, "app")

/** PNG sizes written to public/icons */
const PNG_SIZES = [16, 32, 48, 180, 192, 512] as const

/** Sizes packed into favicon.ico */
const ICO_SIZES = [16, 32, 48] as const

async function svgToPng(svg: Buffer, size: number): Promise<Buffer> {
  return sharp(svg, { density: 384 })
    .resize(size, size, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .png({
      compressionLevel: 9,
      palette: false,
    })
    .toBuffer()
}

async function main() {
  const svg = await readFile(SOURCE_SVG)
  await mkdir(ICONS_DIR, { recursive: true })

  await copyFile(SOURCE_SVG, path.join(PUBLIC_DIR, "logo.svg"))
  console.log("wrote public/logo.svg")

  const pngBySize = new Map<number, Buffer>()

  for (const size of PNG_SIZES) {
    const png = await svgToPng(svg, size)
    pngBySize.set(size, png)
    const out = path.join(ICONS_DIR, `icon-${size}.png`)
    await writeFile(out, png)
    console.log(`wrote ${path.relative(root, out)}`)
  }

  const icoBuffers = await Promise.all(
    ICO_SIZES.map(async (size) => {
      const existing = pngBySize.get(size)
      return existing ?? svgToPng(svg, size)
    })
  )
  const ico = await toIco(icoBuffers)
  const faviconApp = path.join(APP_DIR, "favicon.ico")
  const faviconPublic = path.join(PUBLIC_DIR, "favicon.ico")
  await writeFile(faviconApp, ico)
  await writeFile(faviconPublic, ico)
  console.log("wrote app/favicon.ico")
  console.log("wrote public/favicon.ico")

  // Next.js file conventions
  const icon32 = pngBySize.get(32)!
  const apple = pngBySize.get(180)!
  await writeFile(path.join(APP_DIR, "icon.png"), icon32)
  await writeFile(path.join(APP_DIR, "apple-icon.png"), apple)
  console.log("wrote app/icon.png")
  console.log("wrote app/apple-icon.png")

  console.log("\nDone. Icons generated from assets/brand/logo.svg")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
