import { afterEach, expect, test, vi } from "vitest";
import * as Sentry from "@sentry/browser";
afterEach(async () => {
  await Sentry.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("SDK captures an exception through the same-origin scrubbed relay", async () => {
  vi.stubEnv("NEXT_PUBLIC_MONITORING_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_RELEASE", "b".repeat(40));
  const requests: { url: unknown; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(null, { status: 204 });
  });
  await import("../src/instrumentation-client");
  Sentry.captureException(new Error("private task password=secret"));
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].url).toBe("/api/v1/monitoring/errors");
  expect(requests[0].init?.credentials).toBe("omit");
  const body = String(requests[0].init?.body);
  expect(body).not.toMatch(/private task|password|secret/);
  expect(JSON.parse(body)).toMatchObject({
    release: "b".repeat(40),
    exception: { values: [{ type: "Error" }] },
  });
});
