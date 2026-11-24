import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Providers } from "./providers";
import { useSession } from "../features/auth";
import { useOwnedQuery } from "../features/auth";
import { AuthScreen } from "../features/auth";
const settings = { timezone: "Asia/Tokyo", appearance: "dark", revision: 1 };
function Harness() {
  const s = useSession();
  const data = useOwnedQuery<{ title: string }>("private", "/tasks/test");
  if (!s.session) return <AuthScreen />;
  return (
    <>
      <span>{s.session.user.email}</span>
      <span>{data.data?.title}</span>
      <button onClick={s.logout}>Sign out</button>
    </>
  );
}
it("registers, loads account theme, and clears private data on logout/account switch", async () => {
  let user = "";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (
      String(url).endsWith("/auth/register") ||
      String(url).endsWith("/auth/login")
    ) {
      user = JSON.parse(init!.body as string).email;
      return new Response("{}");
    }
    if (String(url).endsWith("/auth/logout")) {
      user = "";
      return new Response("{}", {
        headers: { "X-Account-ID": "one@example.com" },
      });
    }
    if (String(url).endsWith("/auth/me"))
      return user
        ? new Response(
            JSON.stringify({
              user: { id: user, email: user },
              csrfToken: "csrf",
              settings,
            }),
          )
        : new Response("{}", { status: 401 });
    return new Response(
      JSON.stringify({
        title: user === "one@example.com" ? "Private one" : "Private two",
      }),
      { headers: { "X-Account-ID": user } },
    );
  });
  render(
    <Providers>
      <Harness />
    </Providers>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Create an account" }),
  );
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "one@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "strong-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByText("Private one");
  expect(document.documentElement.dataset.mode).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByLabelText("Email");
  expect(screen.queryByText("Private one")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "two@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "strong-password-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Private two");
  expect(screen.queryByText("Private one")).not.toBeInTheDocument();
});

it("coalesces session refresh and avoids starting requests canceled by Strict Mode", async () => {
  const { StrictMode } = await import("react");
  let meCalls = 0;
  let dataCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).endsWith("/auth/me")) {
      meCalls++;
      return new Response(
        JSON.stringify({
          user: { id: "strict", email: "strict@example.com" },
          csrfToken: "csrf",
          settings,
        }),
      );
    }
    dataCalls++;
    return new Response(JSON.stringify({ title: "Strict data" }), {
      headers: { "X-Account-ID": "strict" },
    });
  });
  function RefreshHarness() {
    const session = useSession();
    return (
      <>
        {session.session && <Harness />}
        <button
          onClick={() => {
            void session.refresh();
            void session.refresh();
          }}
        >
          Refresh together
        </button>
      </>
    );
  }
  const view = render(
    <StrictMode>
      <Providers>
        <RefreshHarness />
      </Providers>
    </StrictMode>,
  );
  await screen.findByText("Strict data");
  expect(meCalls).toBe(1);
  expect(dataCalls).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh together" }));
  await waitFor(() => expect(meCalls).toBe(2));
  expect(dataCalls).toBe(1);
  view.unmount();
});

it("normalizes canceled reads without marking the session offline", async () => {
  const { isCancelledError } = await import("@tanstack/react-query");
  let canceled: unknown;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/auth/me"))
      return new Response(
        JSON.stringify({
          user: { id: "one", email: "one@example.com" },
          csrfToken: "csrf",
          settings,
        }),
      );
    return new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        { once: true },
      );
    });
  });
  function CancellationHarness() {
    const s = useSession();
    return (
      <>
        <span>{s.session?.user.email}</span>
        <span>{s.connected ? "Connected" : "Offline"}</span>
        <button
          onClick={() => {
            const controller = new AbortController();
            void s
              .read("/reports/period", { signal: controller.signal })
              .catch((error) => {
                canceled = error;
              });
            controller.abort();
          }}
        >
          Cancel report
        </button>
      </>
    );
  }
  render(
    <Providers>
      <CancellationHarness />
    </Providers>,
  );
  await screen.findByText("one@example.com");
  fireEvent.click(screen.getByText("Cancel report"));
  await waitFor(() => expect(isCancelledError(canceled)).toBe(true));
  expect(screen.getByText("Connected")).toBeInTheDocument();
});

it("uses one bootstrap loading page until session restore resolves, then exposes offline login", async () => {
  let reject!: (reason: Error) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise<Response>((_, r) => {
        reject = r;
      }),
  );
  const { container } = render(
    <Providers>
      <Harness />
    </Providers>,
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Opening your workspace…",
  );
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByLabelText("Email")).toBeNull();
  reject(new Error("offline"));
  await screen.findByLabelText("Email");
  expect(screen.queryByText("Opening your workspace…")).toBeNull();
  expect(screen.getByText(/Connection unavailable/)).toBeInTheDocument();
});
