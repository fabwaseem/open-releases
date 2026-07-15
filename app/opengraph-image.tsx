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
            color: siteConfig.primary,
            fontWeight: 700,
          }}
        >
          Open source · Desktop
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 96,
                height: 96,
                background: siteConfig.primary,
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                width="56"
                height="56"
                viewBox="0 0 32 32"
                fill="none"
              >
                <path
                  fill="#FAFAFA"
                  d="M15 6h2v10.17l3.59-3.58 1.41 1.41L16 20 9.99 14l1.42-1.41L15 16.17V6Zm-6 14h14v2H9v-2Zm1.5 3h11L23 26H9l1.5-3Z"
                />
              </svg>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 72,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
              }}
            >
              Open Releases
              <span style={{ color: siteConfig.primary }}>.</span>
            </div>
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
