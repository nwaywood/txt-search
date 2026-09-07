import type { Diagnostic, Item, Link } from "./types.js"

const tagPattern = /^#[^\s,\[\]]+$/
const separatorPattern = /^(?:OR|AND)$/i

export type ParseResult =
  | { readonly _tag: "Parsed"; readonly item: Item }
  | { readonly _tag: "Invalid"; readonly diagnostic: Diagnostic }

const invalid = (lineNumber: number, source: string, reason: string): ParseResult => ({
  _tag: "Invalid",
  diagnostic: { lineNumber, source, reason }
})

/** Normalizes only web URLs. The original value remains available for display. */
export const parseLink = (source: string): Link | string => {
  if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^https?:/i.test(source)) {
    return "only http:// and https:// links are supported"
  }

  const href = /^https?:\/\//i.test(source) ? source : `https://${source}`
  try {
    const url = new URL(href)
    if (!/^https?:$/.test(url.protocol)) return "only http:// and https:// links are supported"
    if (!url.hostname) return "link must include a web hostname"
    // Bare URLs must actually look like hostnames rather than arbitrary text.
    if (!/^https?:\/\//i.test(source) && !/^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(source)) {
      return "link must be an absolute HTTP(S) URL or a web hostname"
    }
    return { source, href: url.href }
  } catch {
    return "link is not a valid URL"
  }
}

/** Pure single-line parser; blank lines are intentionally handled by the caller. */
export const parseLine = (lineNumber: number, source: string): ParseResult => {
  const match = /^\s*\[([^\]]*)\]\s+(.+?)\s*$/.exec(source)
  if (!match) return invalid(lineNumber, source, "expected '[#tag, #tag] link (OR|AND link)*'")

  const tagText = match[1]
  if (tagText.trim() === "") return invalid(lineNumber, source, "at least one tag is required")

  const tags = tagText.split(",").map((tag) => tag.trim())
  if (tags.some((tag) => !tagPattern.test(tag))) {
    return invalid(lineNumber, source, "tags must start with # and cannot contain whitespace, commas, or brackets")
  }
  const canonicalTags = [...new Set(tags.map((tag) => tag.toLowerCase()))]

  const tokens = match[2].trim().split(/\s+/)
  if (tokens.length % 2 === 0) return invalid(lineNumber, source, "each link must be separated by OR or AND")
  const links: Link[] = []
  for (let index = 0; index < tokens.length; index += 2) {
    if (index > 0 && !separatorPattern.test(tokens[index - 1])) {
      return invalid(lineNumber, source, "links must be separated by whitespace-delimited OR or AND")
    }
    const link = parseLink(tokens[index])
    if (typeof link === "string") return invalid(lineNumber, source, `invalid link '${tokens[index]}': ${link}`)
    links.push(link)
  }

  return { _tag: "Parsed", item: { lineNumber, tags: canonicalTags, tagCount: canonicalTags.length, links } }
}

export const parseSource = (contents: string): Pick<ItemsSnapshotParts, "items" | "diagnostics" | "tags"> => {
  const items: Item[] = []
  const diagnostics: Diagnostic[] = []
  for (const [index, source] of contents.split(/\r?\n/).entries()) {
    if (source.trim() === "") continue
    const result = parseLine(index + 1, source)
    result._tag === "Parsed" ? items.push(result.item) : diagnostics.push(result.diagnostic)
  }
  const counts = new Map<string, number>()
  for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  const tags = [...counts]
    .map(([tag, rowCount]) => ({ tag, rowCount }))
    .sort((a, b) => b.rowCount - a.rowCount || a.tag.localeCompare(b.tag))
  return { items, diagnostics, tags }
}

type ItemsSnapshotParts = {
  items: Item[]
  diagnostics: Diagnostic[]
  tags: Array<{ tag: string; rowCount: number }>
}
