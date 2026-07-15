import { NotFoundView } from "@/components/not-found/not-found-view"
import { brandCopy } from "@/lib/brand"

export default function RepoNotFound() {
  return (
    <NotFoundView
      title={brandCopy.notFound.repoTitle}
      description={brandCopy.notFound.repoDescription}
      ctaLabel={brandCopy.notFound.repoCta}
    />
  )
}
