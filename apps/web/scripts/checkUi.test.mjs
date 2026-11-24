import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSource } from "./checkUi.mjs";
test("rejects local colors and content loading but allows operation status and data", () => {
  assert.ok(checkSource("a.module.css", "a { color: #fff; }").length);
  assert.ok(checkSource("a.tsx", "const a = <p>Loading tasks…</p>").length);
  assert.equal(
    checkSource(
      "a.tsx",
      "const a = <button><LoadingIndicator/>Saving…</button>",
    ).length,
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
test("detects direct loading expressions and exact hidden class tokens", () => {
  for (const source of [
    "const a=<p>Loading</p>",
    "const a=<p>Fetching tasks…</p>",
    'const a=<p>{pending && "Loading tasks…"}</p>',
    'const a=<p className="not-sr-only">Loading tasks…</p>',
  ])
    assert.ok(checkSource("a.tsx", source).some((e) => e.includes("UI002")));
  for (const source of [
    "a {color: green;}",
    "a {color: rebeccapurple;}",
    "a {background: linear-gradient(red, blue);}",
  ])
    assert.ok(checkSource("a.css", source).some((e) => e.includes("UI001")));
});
test("requires shared indicators in direct pending UI and shared route loading pages", () => {
  assert.ok(
    checkSource(
      "button.tsx",
      'const a=<button>{busy ? "Saving…" : "Save"}</button>',
    ).some((e) => e.includes("UI003")),
  );
  assert.equal(
    checkSource(
      "button.tsx",
      'const a=<button>{busy ? <><LoadingIndicator/>Saving…</> : "Save"}</button>',
    ).length,
    0,
  );
  assert.ok(
    checkSource(
      "feature.module.css",
      "@keyframes spin {to {transform:rotate(360deg);}}",
    ).some((e) => e.includes("UI003")),
  );
  assert.ok(
    checkSource(
      "src/app/loading.tsx",
      "export default function Loading(){return <p>Please wait…</p>}",
    ).some((e) => e.includes("UI004")),
  );
  assert.equal(
    checkSource(
      "src/app/loading.tsx",
      "export default function Loading(){return <LoadingPage/>}",
    ).length,
    0,
  );
});
