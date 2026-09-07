import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { fileURLToPath } from "node:url"
import { parseSource } from "./parser.js"
import type { ItemsSnapshot } from "./types.js"

export class SourceReadError {
  readonly _tag = "SourceReadError"
  constructor(readonly message: string) {}
}

export interface FileAccessShape {
  readonly read: Effect.Effect<{ contents: string; modifiedAt: string | null }, SourceReadError>
}
export const FileAccess = Context.GenericTag<FileAccessShape>("txt-search/FileAccess")

// This remains correct for both `src/backend` during development and `dist/server` after build.
export const inputPath = fileURLToPath(new URL("../../input.txt", import.meta.url))

export const FileAccessLive: Layer.Layer<FileAccessShape> = Layer.effect(
  FileAccess,
  Effect.gen(function* () {
    const filesystem = yield* FileSystem.FileSystem
    return {
      read: Effect.all({
        contents: filesystem.readFileString(inputPath),
        metadata: filesystem.stat(inputPath)
      }).pipe(
        Effect.map(({ contents, metadata }) => ({
          contents,
          modifiedAt: Option.getOrNull(metadata.mtime)?.toISOString() ?? null
        })),
        Effect.mapError((error) => new SourceReadError(error.message))
      )
    }
  })
).pipe(Layer.provide(NodeContext.layer))

export interface SnapshotStoreShape {
  readonly current: Effect.Effect<ItemsSnapshot>
  readonly reload: Effect.Effect<ItemsSnapshot>
}
export const SnapshotStore = Context.GenericTag<SnapshotStoreShape>("txt-search/SnapshotStore")

const emptySnapshot = (message: string): ItemsSnapshot => ({
  items: [], tags: [], diagnostics: [], version: "0", loadedAt: null,
  sourceModifiedAt: null, stale: true, reloadError: message
})

/** A stateful Effect service that deliberately retains a last known-good source snapshot. */
export const SnapshotStoreLive: Layer.Layer<SnapshotStoreShape> = Layer.effect(
  SnapshotStore,
  Effect.gen(function* () {
    const files: FileAccessShape = yield* FileAccess
    const state = yield* Ref.make<ItemsSnapshot>(emptySnapshot("Source file has not been loaded."))
    let successfulLoads = 0

    const reload: Effect.Effect<ItemsSnapshot> = Effect.gen(function* () {
      const attempt = yield* files.read.pipe(Effect.either)
      if (attempt._tag === "Right") {
        const parsed = parseSource(attempt.right.contents)
        successfulLoads += 1
        const snapshot: ItemsSnapshot = {
          ...parsed,
          version: String(successfulLoads),
          loadedAt: new Date().toISOString(),
          sourceModifiedAt: attempt.right.modifiedAt,
          stale: false,
          reloadError: null
        }
        yield* Ref.set(state, snapshot)
        return snapshot
      }

      const previous = yield* Ref.get(state)
      const retained: ItemsSnapshot = { ...previous, stale: true, reloadError: attempt.left.message }
      yield* Ref.set(state, retained)
      return retained
    })

    // Startup failures are state, not fatal server failures; the first request can recover via reload.
    yield* reload
    return { current: Ref.get(state), reload }
  })
).pipe(Layer.provide(FileAccessLive))
