import type { Metadata } from "next"

import { absoluteUrl, siteConfig } from "@/lib/brand"
import { platformLabel } from "@/lib/format"
import type { CatalogRepo } from "@/lib/types"

type BuildMetadataInput = {
  title?: string
  description?: string
  path?: string
  noIndex?: boolean
  image?: string
}

export function buildMetadata({
  title,
  description = siteConfig.description,
  path = "/",
  noIndex = false,
  image,
}: BuildMetadataInput = {}): Metadata {
  const url = absoluteUrl(path)
  const fullTitle = title
    ? `${title} · ${siteConfig.name}`
    : `${siteConfig.name} · ${siteConfig.tagline}`

  return {
    title,
    description,
    applicationName: siteConfig.name,
    keywords: [...siteConfig.keywords],
    authors: [{ name: siteConfig.creator }],
    creator: siteConfig.creator,
    publisher: siteConfig.creator,
    metadataBase: new URL(siteConfig.url),
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/logo.svg", type: "image/svg+xml" },
        { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
    },
    manifest: "/manifest.webmanifest",
    alternates: {
      canonical: url,
    },
    robots: noIndex
      ? { index: false, follow: false }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
    openGraph: {
      type: "website",
      locale: siteConfig.locale,
      url,
      siteName: siteConfig.name,
      title: fullTitle,
      description,
      ...(image
        ? {
            images: [
              {
                url: image,
                width: 1200,
                height: 630,
                alt: siteConfig.name,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    alternateName: siteConfig.shortName,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en",
  }
}

/** Per-repo structured data for download / desktop app pages. */
export function softwareApplicationJsonLd(repo: CatalogRepo) {
  const pageUrl = absoluteUrl(
    `/repo/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
  )
  const operatingSystem = repo.platforms.map(platformLabel).join(", ")
  const release = repo.latest_release

  const offers =
    release.assets.length > 0
      ? release.assets.map((asset) => ({
          "@type": "Offer" as const,
          name: asset.name,
          url: asset.url,
          price: 0,
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        }))
      : {
          "@type": "Offer" as const,
          price: 0,
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: release.url ?? repo.url,
        }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: repo.name,
        alternateName: repo.full_name,
        description:
          repo.description?.trim() ||
          `Open-source desktop app ${repo.full_name} with installers on GitHub Releases.`,
        url: pageUrl,
        downloadUrl: release.url ?? repo.url,
        applicationCategory: "DesktopApplication",
        operatingSystem: operatingSystem || undefined,
        softwareVersion: release.tag || undefined,
        image: repo.avatar_url || undefined,
        author: {
          "@type": "Organization",
          name: repo.owner,
          url: `https://github.com/${repo.owner}`,
        },
        offers,
        isRelatedTo: {
          "@type": "SoftwareSourceCode",
          name: repo.full_name,
          codeRepository: repo.url,
          url: repo.url,
          programmingLanguage: repo.language || undefined,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: siteConfig.name,
            item: siteConfig.url,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: repo.name,
            item: pageUrl,
          },
        ],
      },
    ],
  }
}
