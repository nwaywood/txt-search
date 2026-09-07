export type Link = { source: string; href: string }

export type Item = {
  lineNumber: number
  tags: string[]
  tagCount: number
  links: Link[]
}

export type Diagnostic = {
  lineNumber: number
  source: string
  reason: string
}

export type ItemsSnapshot = {
  items: Item[]
  tags: Array<{ tag: string; rowCount: number }>
  diagnostics: Diagnostic[]
  version: string
  loadedAt: string | null
  sourceModifiedAt: string | null
  stale: boolean
  reloadError: string | null
}
