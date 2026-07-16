"use client"

import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

/** Allow common README HTML (badges, details, screenshots) while staying sanitized. */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "img",
    "details",
    "summary",
    "picture",
    "source",
    "br",
  ],
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "src",
      "alt",
      "title",
      "width",
      "height",
      "loading",
      "align",
    ],
    a: [...(defaultSchema.attributes?.a ?? []), "href", "target", "rel"],
    details: ["open"],
    source: ["src", "srcSet", "type", "media"],
  },
}

/** github.com/owner/repo/blob/ref/path → raw.githubusercontent.com/owner/repo/ref/path */
function toRenderableImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined
  try {
    const url = new URL(src)
    if (url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean)
      // /owner/repo/blob/ref/...rest
      if (parts.length >= 5 && parts[2] === "blob") {
        const [owner, repo, , ref, ...rest] = parts
        return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`
      }
      // /owner/repo/raw/ref/...rest
      if (parts.length >= 5 && parts[2] === "raw") {
        const [owner, repo, , ref, ...rest] = parts
        return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`
      }
    }
    return src
  } catch {
    return src
  }
}

function isBadgeHeight(height: number | undefined) {
  return height != null && Number.isFinite(height) && height > 0 && height <= 80
}

export function ReleaseNotes({
  markdown,
  className,
}: {
  markdown: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "release-notes text-sm leading-relaxed text-muted-foreground",
        // Image-only paragraphs stay inline so consecutive badges/screenshots share a row
        "[&_p:has(>img:only-child)]:mb-0 [&_p:has(>img:only-child)]:inline",
        "[&_p:has(>a:only-child):has(img)]:mb-0 [&_p:has(>a:only-child):has(img)]:inline",
        "[&_p:has(img+img)]:flex [&_p:has(img+img)]:flex-wrap [&_p:has(img+img)]:items-center [&_p:has(img+img)]:gap-1.5",
        "[&_td]:align-middle",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          h1: ({ children }) => (
            <h3 className="mt-6 mb-3 font-heading text-lg font-semibold text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-6 mb-3 font-heading text-base font-semibold text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 mb-2 font-heading text-sm font-semibold text-foreground">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="mb-3 last:mb-0">{children}</p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex font-medium text-primary underline-offset-4 hover:underline"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-muted-foreground">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-primary/50 pl-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isBlock = Boolean(codeClassName?.includes("language-"))
            if (isBlock) {
              return (
                <code
                  className={cn(
                    "block overflow-x-auto rounded-xl bg-background/70 p-3 font-mono text-xs text-foreground",
                    codeClassName
                  )}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground"
                {...props}
              >
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-xl bg-background/70 p-0 last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-4 overflow-x-auto last:mb-0">
              <table className="w-auto max-w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/50 text-foreground">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-border/60 px-2 py-2 font-semibold whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-1.5 py-1.5 align-middle">{children}</td>
          ),
          hr: () => <hr className="my-5 border-border/60" />,
          details: ({ children }) => (
            <details className="mb-4 rounded-xl border border-border/50 bg-background/30 p-3 open:pb-4">
              {children}
            </details>
          ),
          summary: ({ children }) => (
            <summary className="cursor-pointer list-none font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="text-muted-foreground">
                  ▾
                </span>
                {children}
              </span>
            </summary>
          ),
          img: ({ src, alt, height, width }) => {
            const resolved = toRenderableImageSrc(
              typeof src === "string" ? src : undefined
            )
            if (!resolved) return null
            const h =
              typeof height === "string" || typeof height === "number"
                ? Number(height)
                : undefined
            const w =
              typeof width === "string" || typeof width === "number"
                ? Number(width)
                : undefined
            const badge = isBadgeHeight(h)
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolved}
                alt={alt || ""}
                height={Number.isFinite(h) ? h : undefined}
                width={Number.isFinite(w) ? w : undefined}
                loading="lazy"
                className={cn(
                  // Keep inline so badges/screenshots share a row like GitHub
                  "inline-block h-auto w-auto max-w-full align-middle object-contain",
                  badge
                    ? "my-0.5 mr-1 max-h-7 rounded-sm"
                    : "my-1 mr-1 max-h-72 rounded-lg border border-border/40 bg-background/30 sm:max-h-80"
                )}
              />
            )
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
