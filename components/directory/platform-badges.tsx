import {
  AppleLogoIcon,
  LinuxLogoIcon,
  WindowsLogoIcon,
} from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import type { Platform } from "@/lib/types"

const PLATFORM_META: Record<
  Platform,
  { label: string; icon: typeof WindowsLogoIcon; className: string }
> = {
  windows: {
    label: "Windows",
    icon: WindowsLogoIcon,
    className: "text-sky-400",
  },
  macos: {
    label: "macOS",
    icon: AppleLogoIcon,
    className: "text-zinc-200",
  },
  linux: {
    label: "Linux",
    icon: LinuxLogoIcon,
    className: "text-amber-300",
  },
}

export function PlatformBadges({
  platforms,
  className,
}: {
  platforms: Platform[]
  className?: string
}) {
  if (!platforms?.length) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {platforms.map((platform) => {
        const meta = PLATFORM_META[platform]
        if (!meta) return null
        const Icon = meta.icon
        return (
          <span
            key={platform}
            className={cn(
              "inline-flex items-center gap-1 text-xs text-muted-foreground",
              meta.className
            )}
            title={meta.label}
          >
            <Icon className="size-3.5" weight="fill" />
            <span className="sr-only sm:not-sr-only sm:inline">{meta.label}</span>
          </span>
        )
      })}
    </div>
  )
}