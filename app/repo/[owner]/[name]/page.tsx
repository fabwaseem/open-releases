import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { RepoDetailPage } from "@/components/repo/repo-detail-page"
import { getRepoFromCatalog } from "@/lib/catalog"
import { siteConfig } from "@/lib/brand"
import { buildMetadata } from "@/lib/seo"

type PageProps = {
  params: Promise<{ owner: string; name: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { owner, name } = await params
  const fullName = `${owner}/${name}`
  const catalog = await getRepoFromCatalog(owner, name).catch(() => null)

  if (!catalog) {
    return buildMetadata({
      title: "Repository not found",
      description: `The repository ${fullName} is not in the ${siteConfig.name} catalog.`,
      path: `/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      noIndex: true,
    })
  }

  const title = catalog.name ? `${catalog.name} (${fullName})` : fullName
  const description =
    catalog.description?.trim() ||
    `Download the latest open-source desktop release for ${fullName} on ${siteConfig.name} — Windows, macOS, and Linux installers from GitHub.`

  return buildMetadata({
    title,
    description,
    path: `/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  })
}

export default async function Page({ params }: PageProps) {
  const { owner, name } = await params
  const catalog = await getRepoFromCatalog(owner, name).catch(() => null)
  if (!catalog) notFound()

  return <RepoDetailPage owner={owner} name={name} />
}
