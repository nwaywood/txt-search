# TXT Search

A local-first web application for browsing links stored in a plain-text file. It provides tag-based **AND** filtering, fuzzy tag suggestions, manual source reloads, and diagnostics for malformed rows—while retaining the last successfully loaded data if a later reload fails.

Built with React, TypeScript, Node.js, Vite, and Effect.

## Requirements

- A current Node.js LTS release
- npm

## Quick start

```bash
npm install
npm run dev
```

The development servers start at:

- Frontend: <http://localhost:5173>
- Backend/API: <http://localhost:3000>

Vite proxies `/api` requests from the frontend to the backend.

## Source data

The application reads the repository-root [`input.txt`](./input.txt). The source path is resolved relative to the application code, not the shell's current directory, so the server can be started from elsewhere without selecting a different input file.

Each nonblank line represents one result card:

```text
[#tag, #another-tag] example.com OR https://www.example.org/path
```

Rules:

- Every row starts with one or more comma-separated tags in brackets.
- Tags must start with `#`; they are normalized to lowercase and deduplicated.
- A row contains one or more HTTP(S) links. Bare web hostnames are navigated as `https://…`, but retain their original display text.
- Use whitespace-delimited `OR` or `AND` (case-insensitive) between links. Both separators simply add another link to the same row; they do not affect filtering behavior.
- Blank lines are ignored.
- Malformed nonblank rows are omitted from results and shown in the UI diagnostics panel. They do not prevent valid rows from loading.
- Schemes other than `http` and `https` (such as `mailto:`) are rejected.

Edit `input.txt`, then use the application's **Reload** button to apply changes. The app intentionally does not watch the file automatically.

## Filtering and behavior

- Select tags from the catalog, a result card, or the fuzzy tag input.
- Multiple selected tags use **AND** semantics: a row must contain every selected tag.
- Results are ordered by descending number of unique tags; equal counts keep their source-file order.
- The tag catalog is ordered by the number of rows using each tag, then alphabetically.
- Reloads replace the in-memory snapshot when successful. If a reload cannot read the source file, the previous snapshot remains available and is marked stale.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite frontend and Node backend in watch mode. |
| `npm run dev:client` | Start only the Vite frontend. |
| `npm run dev:server` | Start only the backend in watch mode. |
| `npm run build` | Build the frontend into `dist/client` and compile the backend into `dist/server`. |
| `npm start` | Run the production server after building. |
| `npm test` | Run parser tests. |

For a production-style local run:

```bash
npm run build
npm start
```

The backend listens on port `3000` by default. Set `PORT` to override it:

```bash
PORT=8080 npm start
```

## API

The frontend consumes a small JSON API from the Node server:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/items` | Return the current in-memory source snapshot without rereading `input.txt`. |
| `POST` | `/api/reload` | Reread and parse `input.txt`, then return the resulting snapshot. |

A snapshot includes valid items, tag counts, parsing diagnostics, timestamps, a version, and stale/reload-error state.

## Project layout

```text
src/
├── backend/
│   ├── parser.ts       # Pure input.txt parsing and normalization
│   ├── snapshot.ts     # Effect services and last-known-good snapshot state
│   ├── server.ts       # HTTP API and production static-asset server
│   └── parser.test.ts  # Parser tests
└── frontend/
    ├── main.tsx        # React application
    └── styles.css      # UI styles
input.txt               # Link and tag data source
```

## Testing

```bash
npm test
```

The parser tests cover link/tag normalization, multi-link rows, malformed-line diagnostics, tag-catalog ordering, and rejection of unsupported link schemes.
