import assert from "node:assert/strict"
import test from "node:test"
import { parseLine, parseSource } from "./parser.js"

test("parses and normalizes a multi-link row", () => {
  const result = parseLine(4, "[#Tech, #tech, #USA] example.com/path OR https://www.example.org")
  assert.equal(result._tag, "Parsed")
  if (result._tag === "Parsed") {
    assert.deepEqual(result.item.tags, ["#tech", "#usa"])
    assert.equal(result.item.tagCount, 2)
    assert.equal(result.item.links[0].source, "example.com/path")
    assert.equal(result.item.links[0].href, "https://example.com/path")
    assert.equal(result.item.links.length, 2)
  }
})

test("records invalid lines without hiding valid rows", () => {
  const parsed = parseSource("[#one] example.com\n\nthis is not valid\n[#two] two.example AND www.two.example")
  assert.equal(parsed.items.length, 2)
  assert.equal(parsed.diagnostics.length, 1)
  assert.equal(parsed.diagnostics[0].lineNumber, 3)
  assert.match(parsed.diagnostics[0].reason, /expected/)
})

test("orders the tag catalog by row count, then tag name", () => {
  const parsed = parseSource("[#z, #common] one.example\n[#a, #common] two.example\n[#z] three.example")
  assert.deepEqual(parsed.tags, [
    { tag: "#common", rowCount: 2 },
    { tag: "#z", rowCount: 2 },
    { tag: "#a", rowCount: 1 }
  ])
})

test("rejects non-web schemes", () => {
  const result = parseLine(1, "[#contact] mailto:hello@example.com")
  assert.equal(result._tag, "Invalid")
  if (result._tag === "Invalid") assert.match(result.diagnostic.reason, /http/)
})
