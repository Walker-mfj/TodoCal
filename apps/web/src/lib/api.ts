export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "",
  ) {
    super(message);
  }
}
export type RequestOptions = {
  method?: string;
  body?: unknown;
  csrf?: string;
  key?: string;
  signal?: AbortSignal;
  owner?: string;
  onResponse?: (response: Response) => void;
};
export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method || "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      data.error?.message || `Request failed (${response.status})`,
      data.error?.code,
    );
  }
  if (options.owner && response.headers.get("X-Account-ID") !== options.owner) {
    throw new ApiError(
      401,
      "The signed-in account changed. Refreshing your workspace.",
      "account_changed",
    );
  }
  options.onResponse?.(response);
  if (response.status === 204) return undefined as T;
  return response.json();
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "undo_expired") return error.message;
    if (error.status === 401)
      return "Your session expired. Sign in to resume your draft.";
    if (error.status === 409)
      return "This item changed elsewhere. Reload the latest version before saving. Your draft is kept.";
    if (error.status === 422) return `Check your input: ${error.message}`;
    return error.message;
  }
  return error instanceof TypeError
    ? "Connection lost. Your changes are kept. Reconnect and retry."
    : error instanceof Error
      ? error.message
      : "Unable to save. Please try again.";
}
