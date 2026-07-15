import { ImageResponse } from "next/og"

import { siteConfig } from "@/lib/brand"

export const runtime = "edge"
export const alt = siteConfig.name
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#140c0c",
          color: "#fafafa",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#e11d48",
            fontWeight: 700,
          }}
        >
          Open source · Desktop
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
            }}
          >
            Open Releases
            <span style={{ color: "#e11d48" }}>.</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "#d4d4d8",
              maxWidth: 880,
              lineHeight: 1.35,
            }}
          >
            {siteConfig.tagline}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#a1a1aa",
          }}
        >
          open-releases.vercel.app
        </div>
      </div>
    ),
    { ...size }
  )
}
