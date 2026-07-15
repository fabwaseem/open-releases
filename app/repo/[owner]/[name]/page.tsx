import type { Metadata } from "next"

import { RepoDetailPage } from "@/components/repo/repo-detail-page"

type PageProps = {
  params: Promise<{ owner: string; name: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { owner, name } = await params
  return {
    title: `${owner}/${name} · Releases`,
    description: `Latest desktop downloads for ${owner}/${name}`,
  }
}

export default async function Page({ params }: PageProps) {
  const { owner, name } = await params
  return <RepoDetailPage owner={owner} name={name} />
}