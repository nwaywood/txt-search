import { createReadStream, existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { Effect } from "effect"
import { SnapshotStore, SnapshotStoreLive } from "./snapshot.js"

const clientRoot = resolve(fileURLToPath(new URL("../client", import.meta.url)))
const port = Number(process.env.PORT ?? 3000)

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"
}

function fileURLToPath(url: URL) { return decodeURIComponent(url.pathname) }

const writeJson = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(value))
}

const serveFile = async (path: string, response: ServerResponse) => {
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error("not a file")
    response.writeHead(200, { "content-type": contentTypes[extname(path)] ?? "application/octet-stream" })
    createReadStream(path).pipe(response)
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    response.end("Not found")
  }
}

const program = Effect.gen(function* () {
  const snapshots = yield* SnapshotStore
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? "GET"
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname
    if (method === "GET" && pathname === "/api/items") {
      writeJson(response, 200, await Effect.runPromise(snapshots.current))
      return
    }
    if (method === "POST" && pathname === "/api/reload") {
      writeJson(response, 200, await Effect.runPromise(snapshots.reload))
      return
    }
    if (pathname.startsWith("/api/")) {
      writeJson(response, 404, { error: "Unknown API endpoint" })
      return
    }

    const requested = normalize(pathname).replace(/^[/\\]+/, "")
    const candidate = join(clientRoot, requested)
    const safeCandidate = candidate.startsWith(clientRoot) ? candidate : join(clientRoot, "index.html")
    // History fallback lets the single-page application own non-API routes.
    await serveFile(existsSync(safeCandidate) ? safeCandidate : join(clientRoot, "index.html"), response)
  })
}).pipe(Effect.provide(SnapshotStoreLive))

const server = await Effect.runPromise(program)
server.listen(port, () => console.log(`TXT Search listening on http://localhost:${port}`))

const stop = () => server.close(() => process.exit(0))
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
