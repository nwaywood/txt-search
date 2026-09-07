import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveInputPath } from "./snapshot.js"

test("resolveInputPath defaults to input.txt in the current working directory", () => {
  assert.equal(
    resolveInputPath({}, "/tmp/txt-search-working-directory"),
    "/tmp/txt-search-working-directory/input.txt"
  )
})

test("resolveInputPath uses TXT_SEARCH_INPUT_PATH when configured", () => {
  assert.equal(
    resolveInputPath({ TXT_SEARCH_INPUT_PATH: "data/links.txt" }, "/tmp/txt-search-working-directory"),
    "/tmp/txt-search-working-directory/data/links.txt"
  )
  assert.equal(
    resolveInputPath({ TXT_SEARCH_INPUT_PATH: "/var/tmp/links.txt" }, "/tmp/txt-search-working-directory"),
    "/var/tmp/links.txt"
  )
})
