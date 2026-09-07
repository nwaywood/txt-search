import { Effect } from "effect"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import type { ItemsSnapshot } from "../backend/types"
import "./styles.css"

type RequestFailure = { readonly _tag: "RequestFailure"; readonly message: string }

const requestSnapshot = (path: "/api/items" | "/api/reload", method: "GET" | "POST") =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(path, { method, headers: { accept: "application/json" } })
      if (!response.ok) throw new Error(`Request failed (${response.status})`)
      return await response.json() as ItemsSnapshot
    },
    catch: (error) => ({ _tag: "RequestFailure", message: error instanceof Error ? error.message : "Unable to reach the server" } as RequestFailure)
  })

const normalizeTag = (term: string) => {
  const trimmed = term.trim().toLowerCase().replace(/^#*/, "")
  return trimmed ? `#${trimmed}` : null
}

type CatalogTag = ItemsSnapshot["tags"][number]

/** Returns a ranked fuzzy match score, or null when query letters are not in order. */
const fuzzyScore = (tag: string, query: string): number | null => {
  const candidate = tag.slice(1)
  const needle = query.replace(/^#/, "")
  if (!needle) return 0
  const directIndex = candidate.indexOf(needle)
  if (directIndex >= 0) return directIndex
  let position = 0
  let gaps = 0
  for (const character of needle) {
    const found = candidate.indexOf(character, position)
    if (found === -1) return null
    gaps += found - position
    position = found + 1
  }
  return 100 + gaps + candidate.length - needle.length
}

function App() {
  const [snapshot, setSnapshot] = useState<ItemsSnapshot | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [input, setInput] = useState("")
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [catalogExpanded, setCatalogExpanded] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await Effect.runPromise(Effect.either(requestSnapshot("/api/items", "GET")))
    if (result._tag === "Right") { setSnapshot(result.right); setRequestError(null) }
    else setRequestError(result.left.message)
  }, [])
  useEffect(() => { void load() }, [load])

  const visibleItems = useMemo(() => {
    if (!snapshot) return []
    return snapshot.items
      .filter((item) => [...selected].every((tag) => item.tags.includes(tag)))
      .sort((a, b) => b.tagCount - a.tagCount || a.lineNumber - b.lineNumber)
  }, [snapshot, selected])
  const catalog = useMemo(() => [...(snapshot?.tags ?? [])]
    .sort((a, b) => b.rowCount - a.rowCount || a.tag.localeCompare(b.tag)), [snapshot])
  const inputTerms = useMemo(() => input.split(/[\s,]+/).map(normalizeTag).filter((tag): tag is string => tag !== null), [input])
  const trailingTerm = input.split(/[\s,]+/).at(-1) ?? ""
  const currentTerm = normalizeTag(trailingTerm)
  const suggestions = useMemo(() => {
    if (!currentTerm) return []
    return catalog
      .filter(({ tag }) => !selected.has(tag))
      .map((entry) => ({ entry, score: fuzzyScore(entry.tag, currentTerm) }))
      .filter((match): match is { entry: CatalogTag; score: number } => match.score !== null)
      .sort((a, b) => a.score - b.score || b.entry.rowCount - a.entry.rowCount || a.entry.tag.localeCompare(b.entry.tag))
      .slice(0, 6)
      .map(({ entry }) => entry)
  }, [catalog, currentTerm, selected])
  const validTerms = inputTerms.filter((term) => catalog.some(({ tag }) => tag === term))
  const invalidTerms = inputTerms.filter((term) => !catalog.some(({ tag }) => tag === term))
  const canAddExactTerms = inputTerms.length > 0 && invalidTerms.length === 0

  const toggle = (tag: string) => setSelected((current) => {
    const next = new Set(current)
    next.has(tag) ? next.delete(tag) : next.add(tag)
    return next
  })
  const addFilterTag = (tag: string) => setSelected((current) => new Set([...current, tag]))
  const addTags = (tags: string[]) => {
    if (!tags.length) return
    setSelected((current) => new Set([...current, ...tags]))
    setInput("")
    setActiveSuggestion(0)
  }
  const addInputTags = () => {
    // A free-text entry can only become a filter when it exists in the loaded catalog.
    if (canAddExactTerms) addTags(validTerms)
    else if (suggestions[activeSuggestion]) addTags([suggestions[activeSuggestion].tag])
  }
  const reload = async () => {
    setReloading(true); setNotice(null); setRequestError(null)
    const result = await Effect.runPromise(Effect.either(requestSnapshot("/api/reload", "POST")))
    setReloading(false)
    if (result._tag === "Left") { setRequestError(result.left.message); return }
    setSnapshot(result.right)
    const time = result.right.loadedAt ? new Date(result.right.loadedAt).toLocaleTimeString() : "no successful load"
    setNotice(`Reloaded ${result.right.items.length} valid ${result.right.items.length === 1 ? "row" : "rows"} · ${time}`)
  }

  const unavailable = !snapshot || (snapshot.items.length === 0 && snapshot.loadedAt === null)
  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">//</span><div><h1>TXT Search</h1><p>local link index</p></div></div>
      <div className="header-status">
        <span className={`status ${snapshot?.stale ? "warning" : "healthy"}`}>
          <span aria-hidden="true">{snapshot?.stale ? "!" : "●"}</span>
          {snapshot?.stale ? "stale source" : snapshot ? "source loaded" : "connecting"}
        </span>
        <span className="row-total">{snapshot?.items.length ?? 0} valid rows</span>
        <button className="reload" onClick={() => void reload()} disabled={reloading}>{reloading ? "Reloading…" : "Reload"}</button>
      </div>
    </header>

    <section className="filter-panel" aria-labelledby="filter-title">
      <div className="section-heading"><div><p className="eyebrow">FILTERS</p><h2 id="filter-title">Find links by tag</h2></div>
        {selected.size > 0 && <button className="text-button" onClick={() => setSelected(new Set())}>Clear all <span>({selected.size})</span></button>}
      </div>
      <div className="autocomplete">
        <div className="input-row">
          <label className="sr-only" htmlFor="tag-input">Search available tags, with fuzzy autocomplete</label>
          <input id="tag-input" value={input} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="tag-suggestions" aria-activedescendant={suggestions[activeSuggestion] ? `tag-suggestion-${suggestions[activeSuggestion].tag}` : undefined} onChange={(event) => { setInput(event.target.value); setActiveSuggestion(0) }} onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setActiveSuggestion((current) => (current + 1) % suggestions.length) }
            else if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length) }
            else if (event.key === "Enter") { event.preventDefault(); addInputTags() }
            else if (event.key === "Escape") { setInput(""); setActiveSuggestion(0) }
          }} placeholder="Search tags: tech, #usa…" />
          <button onClick={addInputTags} disabled={!canAddExactTerms && !suggestions.length}>Add tags</button>
        </div>
        {suggestions.length > 0 && <ul id="tag-suggestions" className="suggestions" role="listbox" aria-label="Matching valid tags">
          {suggestions.map(({ tag, rowCount }, index) => <li key={tag} id={`tag-suggestion-${tag}`} role="option" aria-selected={index === activeSuggestion}><button className={index === activeSuggestion ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => addTags([tag])}><span>{tag}</span><small>{rowCount} {rowCount === 1 ? "row" : "rows"}</small></button></li>)}
        </ul>}
        {input.trim() && invalidTerms.length > 0 && suggestions.length === 0 && <p className="input-hint" role="status">No matching valid tag. Choose a tag from the catalog below.</p>}
      </div>
      {selected.size > 0 && <div className="selected-tags" aria-label="Selected tag filters">
        {[...selected].sort().map((tag) => <button key={tag} className="selected-tag" onClick={() => toggle(tag)} aria-label={`Remove ${tag} filter`}>{tag}<span aria-hidden="true">×</span></button>)}
        <span className="and-note">all tags required</span>
      </div>}
      <div id="tag-catalog" className={`catalog ${catalogExpanded ? "is-expanded" : "is-collapsed"}`} aria-label="Available source tags, ordered by source-row count">
        {catalog.map(({ tag, rowCount }) => <button key={tag} className={`catalog-tag ${selected.has(tag) ? "is-selected" : ""}`} onClick={() => toggle(tag)} aria-pressed={selected.has(tag)}><span>{tag}</span><b>{rowCount}</b></button>)}
        {snapshot && snapshot.tags.length === 0 && <span className="muted">No tags are available in the current source.</span>}
      </div>
      {catalog.length > 0 && <button className="catalog-toggle" type="button" aria-expanded={catalogExpanded} aria-controls="tag-catalog" onClick={() => setCatalogExpanded((expanded) => !expanded)}>{catalogExpanded ? "Show fewer tags" : `Show all ${catalog.length} tags`} <span aria-hidden="true">{catalogExpanded ? "↑" : "↓"}</span></button>}
    </section>

    <div className="announcements" role="status" aria-live="polite">
      {notice && <p className="success-message">✓ {notice}</p>}
      {requestError && <p className="error-message">Request error: {requestError}. Try Reload.</p>}
      {snapshot?.stale && <p className="warning-message">⚠ Source unavailable: {snapshot.reloadError ?? "last reload failed"}. {snapshot.loadedAt ? "Showing previously loaded data." : "Restore input.txt and choose Reload."}</p>}
    </div>

    {snapshot && snapshot.diagnostics.length > 0 && <details className="diagnostics">
      <summary><strong>⚠ {snapshot.diagnostics.length} {snapshot.diagnostics.length === 1 ? "line" : "lines"} could not be parsed</strong><span>View details</span></summary>
      <div className="diagnostic-list">{snapshot.diagnostics.map((diagnostic) => <article key={`${diagnostic.lineNumber}-${diagnostic.source}`}>
        <div><b>Line {diagnostic.lineNumber}</b><span>{diagnostic.reason}</span></div><code>{diagnostic.source}</code>
      </article>)}</div>
    </details>}

    <section className="results" aria-labelledby="results-title">
      <div className="results-heading"><div><p className="eyebrow">RESULTS</p><h2 id="results-title">{visibleItems.length} <span>of {snapshot?.items.length ?? 0} valid rows</span></h2></div><p>ordered by tag count</p></div>
      {unavailable ? <div className="empty-state"><h2>Source file is not available</h2><p>The server could not load <code>input.txt</code>. Restore it, then use Reload to recover without restarting the app.</p><button onClick={() => void reload()} disabled={reloading}>Try Reload</button></div>
        : visibleItems.length === 0 ? <div className="empty-state"><h2>No rows match these tags</h2><p>The source catalog remains available above. Remove a tag or clear all filters to see every valid row.</p></div>
        : <div className="cards">{visibleItems.map((item) => <article className="card" key={item.lineNumber}>
          <div className="card-meta"><div className="chips">{item.tags.map((tag) => <button type="button" className="chip" key={tag} onClick={() => addFilterTag(tag)} aria-label={`Add ${tag} filter`}>{tag}</button>)}</div><span className="tag-count">{item.tagCount} {item.tagCount === 1 ? "tag" : "tags"}</span></div>
          <ul>{item.links.map((link, index) => <li key={`${link.source}-${index}`}><a href={link.href} target="_blank" rel="noopener noreferrer">{link.source}<span aria-hidden="true">↗</span></a></li>)}</ul>
        </article>)}</div>}
    </section>
  </main>
}

createRoot(document.getElementById("root")!).render(<App />)
