import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: {
    // Deliberate: next/image is only used for GitHub avatars (44/96px,
    // already CDN-served), so the optimizer adds a hop + quota burn for
    // no gain. Revisit if large first-party imagery is ever added —
    // remotePatterns + sharp are already in place for that day.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "github.com",
      },
    ],
  },
}

export default nextConfig