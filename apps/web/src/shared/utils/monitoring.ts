type Frame = {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
};
type Report = {
  release?: string;
  exception: {
    values: { type: string; value: string; stacktrace: { frames: Frame[] } }[];
  };
};
const symbol = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_.$*/<>()[\] -]{1,160}$/.test(value)
    ? value
    : "Error";
const position = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 10_000_000
    ? value
    : undefined;

// Local caps reduce traffic; the API's durable daily budget is authoritative.
export function createErrorReporter(
  send: (event: Report) => void,
  now = Date.now,
) {
  let total = 0,
    count = 0,
    windowStart = 0;
  const seen = new Map<string, number>();
  return (input: unknown) => {
    try {
      const raw = input as {
        release?: string;
        exception?: {
          values?: {
            type?: unknown;
            stacktrace?: { frames?: Record<string, unknown>[] };
          }[];
        };
      };
      if (!Array.isArray(raw?.exception?.values) || total >= 20) return;
      const event: Report = {
        release:
          typeof raw.release === "string" && /^[a-f0-9]{40}$/.test(raw.release)
            ? raw.release
            : undefined,
        exception: {
          values: raw.exception.values.slice(0, 3).map((ex) => ({
            type: symbol(ex.type),
            value: "Error details removed for privacy",
            stacktrace: {
              frames: (ex.stacktrace?.frames || []).slice(-30).flatMap((f) => {
                if (typeof f.filename !== "string") return [];
                const url = new URL(f.filename, "https://local.invalid");
                if (
                  !url.pathname.startsWith("/_next/static/") ||
                  url.pathname.length > 250
                )
                  return [];
                return [
                  {
                    filename: url.pathname,
                    function: symbol(f.function),
                    lineno: position(f.lineno),
                    colno: position(f.colno),
                  },
                ];
              }),
            },
          })),
        },
      };
      if (!event.exception.values.length) return;
      const time = now(),
        key = JSON.stringify(event);
      if (time - windowStart >= 60_000) {
        windowStart = time;
        count = 0;
      }
      const previous = seen.get(key);
      if (count >= 5 || (previous !== undefined && time - previous < 300_000))
        return;
      total++;
      count++;
      seen.set(key, time);
      send(event);
    } catch {
      /* Monitoring must never break the application. */
    }
  };
}

export const reportBrowserError = createErrorReporter((event) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  void fetch("/api/v1/monitoring/errors", {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: controller.signal,
    cache: "no-store",
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
});
