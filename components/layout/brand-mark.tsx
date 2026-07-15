import { siteConfig } from "@/lib/brand"
import { cn } from "@/lib/utils"

export function BrandMark({
  className,
  as: Comp = "span",
  showWordmark = true,
}: {
  className?: string
  as?: "span" | "div"
  showWordmark?: boolean
}) {
  return (
    <Comp
      className={cn(
        "inline-flex items-center gap-2 font-heading font-semibold tracking-tight",
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG from /public */}
      <img
        src="/logo.svg"
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0"
      />
      {showWordmark ? (
        <span>
          {siteConfig.name}
          <span className="text-primary">{siteConfig.mark}</span>
        </span>
      ) : (
        <span className="sr-only">{siteConfig.name}</span>
      )}
    </Comp>
  )
}
