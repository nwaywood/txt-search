# TXT Search — Product and Technical Specification

## 1. Overview

TXT Search is a local-first, single-user web application for browsing and filtering links stored in a static text file. It has:

- A TypeScript React frontend.
- A TypeScript Node.js backend.
- Effect (`effect-ts`) as the primary framework for effects, errors, resource lifecycle, and services.
- One deployable Node.js service: it serves the built React assets and exposes the application API.

The backend reads a single, hardcoded `input.txt` file that is anchored to the application/project location rather than the Node process's current working directory. Authentication, multi-user behavior, hosted storage, and deployment infrastructure are out of scope.

## 2. Goals

1. Display all valid source-file rows and their associated links.
2. Let users filter results by one or more tags using **AND** semantics.
3. Let users manually reload content after the source file changes.
4. Preserve usable previously loaded data if a later reload cannot read the file.
5. Make invalid source lines understandable without hiding valid data.
6. Provide a polished, dense, desktop-oriented developer-tool interface.

## 3. Non-goals

- Automatic file watching, polling, SSE, WebSockets, or automatic browser refresh.
- Editing `input.txt` through the website.
- User accounts, permissions, or concurrent-user collaboration.
- Multiple input files or a configurable runtime file path.
- Mobile-specific layouts or a theme switcher.
- Supporting comments in `input.txt`.
- Link schemes other than HTTP and HTTPS.

## 4. Source-file format

### 4.1 Location

The backend contains a constant for the file path. It resolves `input.txt` from a stable application-relative location, not `process.cwd()`, so starting the server from another directory does not change the source file.

The current source file is located at the project root:

```text
input.txt
```

### 4.2 Valid row grammar

Each nonblank row represents one result item:

```text
[<tag>, <tag>, ...] <link> ((OR|AND) <link>)*
```

Example:

```text
[#social_media, #tech, #meta, #usa] www.facebook.com OR www.messenger.com
```

Interpretation:

- The bracketed list is the row's tag set.
- The row has one or more links.
- Every link on that row shares the same tag set.
- `OR` and `AND` are whitespace-delimited, case-insensitive separators between links. They are equivalent syntax only; neither expresses boolean behavior. For example, `one.example OR two.example` and `one.example AND two.example` both produce one row containing two links.
- A row remains one result item even if it contains several links.

### 4.3 Blank lines and invalid lines

- Blank or whitespace-only lines are ignored.
- Comment lines and inline comments are **not** supported.
- Every nonblank line must meet the valid-row grammar.
- A malformed nonblank line does not invalidate the rest of the file. It is excluded from results and recorded as a diagnostic containing its one-based line number, original text, and parse failure reason.

### 4.4 Tags

A source tag must begin with `#` and may not contain brackets, commas, or whitespace.

Tags are normalized as follows:

- Comparison is case-insensitive.
- The canonical internal and display representation is lowercase with a leading `#`.
- Duplicate tags on a row are deduplicated.
- Tag count means the number of canonical, unique tags on that row.

For example:

```text
[#Tech, #tech, #USA]
```

becomes the displayed tag set `#tech`, `#usa`, with a tag count of `2`.

### 4.5 Links

Each source link must be either:

- An absolute `http://` or `https://` URL, or
- A bare web hostname/URL such as `www.example.com` or `example.com/path`.

Bare web URLs are normalized to `https://…` for navigation. The UI displays the original source value so it never silently rewrites the user's text.

Other schemes, including `mailto:`, `file:`, and custom schemes, are invalid and generate a line diagnostic. Valid links open in a new browser tab using safe external-link attributes (`target="_blank"` and `rel="noopener noreferrer"`).

## 5. Backend behavior

### 5.1 Effect-based service design

The Node backend uses Effect services/layers for file access, parsing, snapshot state, HTTP handling, and server lifecycle. Expected building blocks include `effect`, `@effect/platform`, and the Node platform implementation.

The parser is a pure, typed operation that returns either a parsed row or a structured line diagnostic. Expected runtime failures—missing file, unreadable file, malformed content—are represented as typed Effect errors rather than unchecked exceptions.

### 5.2 In-memory snapshot

At startup, the backend attempts to read and parse the hardcoded file, then keeps the latest result in memory. A snapshot contains:

- Valid parsed rows.
- The unique tag catalog and per-tag row counts.
- Parse diagnostics.
- Source-file metadata where available (for example, modified time).
- Snapshot version and successful-load timestamp.
- A stale/error indicator when the latest reload attempt could not read the file.

The backend does not watch the file. File changes take effect only after a successful `POST /api/reload` request.

### 5.3 Reload rules

`POST /api/reload` explicitly rereads and reparses the hardcoded file.

- **Readable file, including malformed lines:** Replace the snapshot with the valid rows and diagnostics from the new file. A successful parse may have diagnostics.
- **Unreadable file after a previous successful load:** Keep serving the prior snapshot, mark it stale, and include the latest reload error. The UI remains usable.
- **Unreadable file at first startup:** Start the web server but retain no rows. The API reports an empty/error state; the website renders an actionable error view and offers Reload so it can recover without a server restart.

## 6. HTTP contract

The application API is internal to the React frontend but follows a stable JSON contract.

### `GET /api/items`

Returns the current backend snapshot. The backend does not reread the file for this endpoint.

Conceptual response shape:

```ts
type Link = {
  source: string
  href: string
}

type Item = {
  lineNumber: number
  tags: string[]
  tagCount: number
  links: Link[]
}

type Diagnostic = {
  lineNumber: number
  source: string
  reason: string
}

type ItemsSnapshot = {
  items: Item[]
  tags: Array<{ tag: string; rowCount: number }>
  diagnostics: Diagnostic[]
  version: string
  loadedAt: string | null
  sourceModifiedAt: string | null
  stale: boolean
  reloadError: string | null
}
```

### `POST /api/reload`

Forces a source-file reread and returns the resulting current snapshot, including any stale-data state or reload error. A reload failure after a previous successful load still returns the retained snapshot so the frontend can continue displaying it and warn the user.

## 7. Frontend behavior

### 7.1 Data loading

On initial page load, React requests `GET /api/items`. The complete snapshot is held client-side.

The backend supplies parsed data only; filtering and ordering run in React. This makes changing a filter immediate and avoids requests for each selection.

React-side asynchronous calls and state transitions should use Effect-compatible TypeScript patterns, with the UI handling Effect success and typed-failure states explicitly.

### 7.2 Filter controls

The filter area provides both:

1. A free-text tag input with fuzzy autocomplete suggestions.
2. Clickable tag controls generated from the complete loaded-file tag catalog.

Input rules:

- Users may enter tag terms separated by spaces and/or commas.
- A leading `#` is optional in the input.
- The input offers a ranked fuzzy autocomplete list from unselected, valid catalog tags. Contiguous matches rank ahead of ordered-character (subsequence) matches; a match is selected only when the user chooses a suggestion (by mouse or keyboard) or submits an exact tag.
- Input matching is case-insensitive and exact after normalization when submitted directly. `tech`, `#tech`, and `TECH` all select `#tech`.
- A typed term that does not exist in the latest tag catalog must never become an active filter. When it has no fuzzy suggestion, the add action is unavailable and the UI explains that no valid tag matches it.
- The autocomplete list and Add action may select only valid catalog tags. Arrow keys and Enter support choosing suggestions; Escape clears the current input.
- Duplicate selected terms have no additional effect.

All active tags use AND semantics. Selecting `#tech` and `#usa` returns only rows containing both tags. A row matching the filter displays all its links, not only a link that caused a match.

The tag catalog:

- Always contains every tag from the latest loaded snapshot, even when the current result set is empty.
- Is ordered by source-row count descending, with alphabetical tag order as the deterministic tie-breaker.
- Shows two complete visual rows by default; a Show all / Show fewer control expands or collapses the remaining catalog tags without affecting active filters.
- Shows each tag's count of source rows.
- Leaves selected tags visible and selectable even when the combination has no matches.

Selected tags have a clear selected state and can be removed individually; clearing the search/filter state returns all rows.

### 7.3 Result ordering

Rows always sort by total unique tag count in descending order:

1. More-tagged rows appear before less-tagged rows.
2. Rows with equal tag counts retain their original `input.txt` order.

Filtering does not change this ordering rule. It filters the matching set and then retains the same descending-tag-count, stable source-order sort.

### 7.4 Result cards

Each valid source row renders as one compact result card containing:

- Its canonical tag chips. Each chip is a keyboard-accessible button; activating it adds that tag to the active AND filter without removing existing selections.
- Its tag count.
- A vertical list of every source link associated with that row.

Each link is independently clickable. The displayed text is the original source link; navigation uses the normalized safe HTTP(S) URL.

The main page also reports visible result count and total valid-row count, so users can understand the impact of a filter.

### 7.5 Manual reload

The page includes a prominent **Reload** button.

On activation:

1. It indicates loading and prevents duplicate concurrent clicks.
2. It calls `POST /api/reload`.
3. It replaces the client snapshot with the returned current snapshot.
4. It preserves active filter selections and recalculates visible results against the new snapshot.
5. It displays a brief, non-intrusive success status, including row count and reload time.

If the request or source read fails, show a clear error/stale-data warning. If a previous snapshot exists, continue to show it. If no snapshot has ever loaded, show an actionable empty/error state rather than a blank page.

### 7.6 Diagnostics

When any malformed rows exist, show a compact warning summary near the results, for example:

> 2 lines could not be parsed

The summary opens a collapsible diagnostics panel. Each diagnostic includes the source line number, original line text, and reason. Diagnostics do not replace or interrupt valid results.

## 8. Visual and interaction design

The page is desktop-only and uses a polished, dark-first developer-tool aesthetic.

### Layout

- Dense but readable desktop composition.
- A top application bar with the product title, current source/reload status, valid-row count, and Reload button.
- A prominent filter area directly below the bar, with text input, selected-tag state, and tag catalog.
- A main results column containing compact cards in the required sort order.
- A diagnostics summary/panel that is noticeable without dominating normal results.

### Style

- Dark background with layered surfaces for controls and result cards.
- High-contrast text, restrained accent colors, and clear status colors for success, warning, error, and selected tags.
- Compact monospace or developer-oriented typography where appropriate, while retaining readable body text.
- Deliberate hover, active, disabled, and keyboard-focus states.
- Subtle borders, spacing, and transitions rather than ornamental visual effects.

### Accessibility and interaction

Although mobile layout is out of scope, desktop interaction must remain keyboard usable:

- Native buttons and links are used where applicable.
- Focus state is visible.
- Inputs and controls have accessible labels.
- Reload status and errors are announced in an accessible status region.
- Color is not the sole way to identify selected, warning, or error state.

## 9. Key acceptance scenarios

1. Given a valid single-link line, the main page displays one card with its tags and clickable link.
2. Given a row with `OR` or `AND` separated links, one card displays all links under the same tags.
3. Selecting `tech` and `usa` displays only rows containing both canonical tags.
4. Filtering preserves descending tag-count ordering and preserves source order for tied counts.
5. Entering `#TECH`, `tech`, or `TECH` produces the same tag filter.
6. A blank line is ignored; a malformed nonblank line appears in diagnostics while valid rows remain visible.
7. Clicking Reload after changing `input.txt` updates the displayed snapshot without clearing active filters.
8. If a post-startup reload cannot read the file, the prior rows remain visible with a stale-data warning.
9. If the initial read cannot find or read the file, the application loads an actionable error view and recovers after the file is restored and Reload is clicked.
10. Bare hostnames navigate as HTTPS links, while non-HTTP(S) link schemes are rejected with diagnostics.
11. The catalog orders higher row-count tags before lower row-count tags, using alphabetical order for ties.
12. A fuzzy input such as `tch` can suggest `#tech`, while an unmatched input cannot be added as an active filter.
13. A large tag catalog initially shows two rows of tag controls and can be expanded to show every tag, then collapsed again.
14. Activating a tag chip on a result card adds that tag to the active filter while retaining any existing selected tags.
