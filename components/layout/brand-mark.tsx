import { siteConfig } from "@/lib/brand"
import { cn } from "@/lib/utils"

export function BrandMark({
  className,
  as: Comp = "span",
}: {
  className?: string
  as?: "span" | "div"
}) {
  return (
    <Comp className={cn("font-heading font-semibold tracking-tight", className)}>
      {siteConfig.name}
      <span className="text-primary">{siteConfig.mark}</span>
    </Comp>
  )
}
