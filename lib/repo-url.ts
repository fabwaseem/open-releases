/** Parse GitHub repo URLs or `owner/name` into a normalized full name. */
export function parseGithubRepoInput(raw: string): {
  owner: string
  name: string
  fullName: string
  sourceUrl: string
} | null {
  const input = raw.trim()
  if (!input) return null

  const slugMatch = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (slugMatch) {
    const owner = slugMatch[1]!
    const name = slugMatch[2]!.replace(/\.git$/, "")
    return {
      owner,
      name,
      fullName: `${owner}/${name}`,
      sourceUrl: `https://github.com/${owner}/${name}`,
    }
  }

  let url: URL
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`)
  } catch {
    return null
  }

  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null

  const parts = url.pathname.split("/").filter(Boolean)
  if (parts.length < 2) return null

  const owner = parts[0]!
  const name = parts[1]!.replace(/\.git$/, "")
  if (!owner || !name) return null

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    sourceUrl: `https://github.com/${owner}/${name}`,
  }
}
