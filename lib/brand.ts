/**
 * Open Releases — product copy, URLs, and SEO defaults.
 */

export const siteConfig = {
  name: "Open Releases",
  shortName: "Open Releases",
  /** Shown after the name with accent styling */
  mark: ".",
  /**
   * Brand primary (matches dark `--primary: oklch(0.62 0.24 25)` in globals.css).
   * Used in SVG logo, favicon, manifest, and OG assets that need a hex color.
   */
  primary: "#f51d31",
  tagline: "Open-source apps with real release downloads.",
  description:
    "Browse a living directory of open-source Windows, macOS, Linux, Android, and iOS apps shipping on GitHub Releases. Search, filter by platform, and open the latest installer.",
  url:
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://open-releases.vercel.app",
  locale: "en_US",
  creator: "Open Releases",
  keywords: [
    "open source apps",
    "GitHub releases",
    "Windows open source software",
    "macOS open source apps",
    "Linux desktop apps",
    "Android open source APK",
    "iOS open source IPA",
    "open source downloads",
    "desktop installers",
    "mobile app releases",
    "open source directory",
    "latest GitHub releases",
  ],
} as const

export const brandCopy = {
  logoText: "Open Releases",

  hero: {
    eyebrow: "Open source · Releases",
    title: "Apps ready to install",
    descriptionMobile:
      "Windows, macOS, Linux, Android & iOS from GitHub — search and open the latest release.",
    description:
      "A living directory of open-source projects with real installers: Windows, macOS, Linux, Android, and iOS. Search, filter, and jump straight to the latest GitHub release.",
  },

  search: {
    placeholder: "Search name, tag, description…",
  },

  empty: {
    title: "No apps match",
    body: "Try another search term or clear the platform filter.",
    reset: "Reset filters",
    end: "You’re all caught up",
  },

  favorites: {
    eyebrow: "Your collection",
    title: "Favorites",
    description: "Desktop apps you saved for later.",
    emptyTitle: "No favorites yet",
    emptyBody: "Browse the directory and tap the heart on apps you like.",
    cta: "Browse Open Releases",
  },

  auth: {
    signInSupport: "Sign in to save favorites and pick up where you left off.",
    signUpSupport:
      "Create an account to save desktop apps and track releases you care about.",
  },

  addRepo: {
    title: "Add a repository",
    descriptionAdmin:
      "Paste a GitHub repository URL, fetch its details, then add it to Open Releases. We’ll verify installers (desktop or mobile) in the latest releases.",
    descriptionUser:
      "Paste a GitHub repository URL, fetch its details, then submit it for review. We’ll verify installers (desktop or mobile) in the latest releases.",
  },

  repo: {
    back: "Browse directory",
  },

  notFound: {
    code: "404",
    title: "Page not found",
    description:
      "That URL doesn’t match anything on Open Releases. Check the address or head back to the directory.",
    cta: "Browse directory",
    repoTitle: "Repository not found",
    repoDescription:
      "This project isn’t in the Open Releases catalog — it may have been removed, hidden, or never added.",
    repoCta: "Browse directory",
  },

  error: {
    code: "500",
    title: "Something went wrong",
    description:
      "We hit an unexpected error. Try again, or head back to the directory while we sort it out.",
    retry: "Try again",
    cta: "Browse directory",
  },

  admin: {
    brandSubtitle: "Admin console",
  },
} as const

export function absoluteUrl(path = "/") {
  const base = siteConfig.url
  if (!path || path === "/") return base
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}
