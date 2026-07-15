import { NotFoundView } from "@/components/not-found/not-found-view"
import { brandCopy } from "@/lib/brand"

export default function NotFound() {
  return (
    <NotFoundView
      title={brandCopy.notFound.title}
      description={brandCopy.notFound.description}
      ctaLabel={brandCopy.notFound.cta}
    />
  )
}
