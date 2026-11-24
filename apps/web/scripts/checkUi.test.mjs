import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSource } from "./checkUi.mjs";
test("rejects local colors and content loading but allows operation status and data", () => {
  assert.ok(checkSource("a.module.css", "a { color: #fff; }").length);
  assert.ok(checkSource("a.tsx", "const a = <p>Loading tasks…</p>").length);
  assert.equal(
    checkSource("a.tsx", "const a = <button>Saving…</button>").length,
    0,
  );
  assert.equal(
    checkSource("a.module.css", "a { color: var(--color-ink); }").length,
    0,
  );
  assert.equal(
    checkSource("a.tsx", "const a = <i style={{color: group.color}} />").length,
    0,
  );
});
test("recognizes expression and suspense placeholders without rejecting accessible text or anchors", () => {
  for (const source of [
    'const a=<p>{"Loading tasks…"}</p>',
    'const a=<Suspense fallback="Loading…"/>',
    'const a=<i style={{color:"red"}}/>',
  ])
    assert.ok(checkSource("a.tsx", source).length);
  for (const source of [
    'const a=<span className="sr-only">Loading tasks…</span>',
    'const a=<a href="#abc">Link</a>',
  ])
    assert.equal(checkSource("a.tsx", source).length, 0);
});
