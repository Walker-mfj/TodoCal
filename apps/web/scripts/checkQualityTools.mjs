// Verify that the pinned binaries and committed configuration reject violations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web = fileURLToPath(new URL("../", import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "todocal-quality-"));
function run(binary, args, status, rule) {
  const result = spawnSync(path.join(web, "node_modules/.bin", binary), args, {
    cwd: web,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    status,
    result.error?.message || result.stdout + result.stderr,
  );
  if (rule) assert.match(result.stdout + result.stderr, rule);
}
try {
  const lint = [
    "--config",
    path.join(web, ".oxlintrc.json"),
    "--deny-warnings",
  ];
  for (const [name, source, diagnostic] of [
    [
      "hooks.tsx",
      'import {useState} from "react"; export function Component({ok}) { if(ok) useState(0); return null; }',
      /rules-of-hooks/,
    ],
    [
      "next.tsx",
      'export default function Component(){return <script src="/sync.js"/>;}',
      /no-sync-scripts/,
    ],
    [
      "types.ts",
      "export enum Duplicate {A=0, B=0}",
      /no-duplicate-enum-values/,
    ],
  ]) {
    const file = path.join(temp, name);
    fs.writeFileSync(file, source);
    run("oxlint", [...lint, file], 1, diagnostic);
    fs.unlinkSync(file);
  }
  const file = path.join(temp, "format.ts");
  fs.writeFileSync(file, "export const value={x:1,y:2}\n");
  const config = ["--config", path.join(web, ".oxfmtrc.json")];
  run("oxfmt", [...config, "--check", file], 1);
  run("oxfmt", [...config, "--write", file], 0);
  run("oxfmt", [...config, "--check", file], 0);
  console.log(
    "Pinned formatter and React Hooks/Next.js/TypeScript lint gates verified.",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
