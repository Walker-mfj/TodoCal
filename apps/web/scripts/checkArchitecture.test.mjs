import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkArchitecture } from "./checkArchitecture.mjs";

test("resolves aliases, re-exports, lazy imports and cycles across feature APIs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todocal-boundaries-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  function put(file, body) {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
  put(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        moduleResolution: "bundler",
        paths: { "@/*": ["./src/*"] },
      },
    }),
  );
  put("src/features/tasks/index.ts", "export const task = 1;");
  put("src/features/auth/index.ts", "export const session = 1;");
  put("src/features/auth/private.ts", "export const secret = 1;");
  put("src/shared/transport.ts", "export const read = 1;");
  put(
    "src/features/tasks/query.ts",
    'import { session } from "@/features/auth"; import { read } from "../../shared/transport";',
  );
  assert.deepEqual(checkArchitecture(dir), []);
  put("src/shared/leak.ts", 'export * from "@/features/tasks";');
  put("src/features/tasks/lazy.ts", 'void import("../auth/private");');
  put("src/features/auth/other.ts", 'import type { Task } from "../tasks";');
  put("src/features/auth/view.module.css", ".view {}");
  put(
    "src/features/tasks/styles.ts",
    'import styles from "@/features/auth/view.module.css";',
  );
  const errors = checkArchitecture(dir);
  assert.equal(errors.length, 4);
  assert.ok(
    errors.some((e) => e.startsWith("shared/leak.ts imports features/tasks/")),
  );
  assert.ok(
    errors.some((e) =>
      e.startsWith("features/tasks/lazy.ts imports features/auth/private.ts"),
    ),
  );
  assert.ok(
    errors.some((e) => e.includes("imports features/auth/view.module.css")),
  );
  assert.ok(errors.some((e) => e.startsWith("Feature dependency cycle:")));
});
