import { expect, test } from "vitest";
import { createErrorReporter } from "../src/lib/monitoring";

test("monitoring scrubs private data, deduplicates and caps sends", () => {
  const events: unknown[] = [];
  let now = 0;
  const report = createErrorReporter(
    (e) => {
      events.push(e);
    },
    () => now,
  );
  const event = (line: number) => ({
    user: { email: "private@example.com" },
    request: { cookies: "secret" },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "private task",
          stacktrace: {
            frames: [
              {
                filename: "https://app.example/_next/static/a.js?secret=yes",
                lineno: line,
                function: "save",
                vars: { password: "secret" },
              },
            ],
          },
        },
      ],
    },
  });
  for (let i = 0; i < 100; i++) report(event(i % 10));
  expect(events).toHaveLength(5);
  expect(JSON.stringify(events)).not.toMatch(/private|password|secret|cookies/);
  now = 60001;
  report(event(0));
  expect(events).toHaveLength(5);
  for (let round = 0; round < 10; round++) {
    now += 300001;
    for (let i = 0; i < 10; i++) report(event(i));
  }
  expect(events).toHaveLength(20);
});
test("monitoring transport failures do not escape", () => {
  const report = createErrorReporter(() => {
    throw new Error("offline");
  });
  expect(() =>
    report({ exception: { values: [{ type: "Error" }] } }),
  ).not.toThrow();
});

test("preserves only a valid build revision for source map lookup", () => {
  const sent: unknown[] = [];
  const report = createErrorReporter((e) => sent.push(e));
  report({
    release: "a".repeat(40),
    exception: { values: [{ type: "Error" }] },
  });
  expect(sent[0]).toHaveProperty("release", "a".repeat(40));
});
