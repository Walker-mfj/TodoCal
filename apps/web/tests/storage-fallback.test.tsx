import { it, expect, vi } from "vitest";
import {
  renderHook,
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { useCommand } from "../src/lib/use-command";
import { useAccountDraft } from "../src/lib/use-account-draft";
import { TaskEditor } from "../src/features/tasks/editor";

it("keeps exact uncertain command across remounts when storage writes exceed quota", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Lost response"))
    .mockResolvedValue({});
  const key = "focus:command:quota-owner:save";
  const first = renderHook(() => useCommand(execute, key));
  await act(async () => {
    await first.result.current.run("/tasks", "POST", { title: "Original" });
  });
  expect(first.result.current.busy).toBe(false);
  expect(first.result.current.uncertain).toBe(true);
  const original = structuredClone(execute.mock.calls[0]);
  first.unmount();
  const second = renderHook(() => useCommand(execute, key));
  expect(second.result.current.uncertain).toBe(true);
  await act(async () => {
    await second.result.current.run("/tasks", "POST", { title: "Changed" });
  });
  expect(execute.mock.calls[1]).toEqual(original);
  expect(second.result.current.uncertain).toBe(false);
  expect(second.result.current.busy).toBe(false);
});
it("retains account drafts when accessing sessionStorage itself is denied", () => {
  const deny = vi
    .spyOn(window, "sessionStorage", "get")
    .mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
  try {
    const first = renderHook(() =>
      useAccountDraft("focus:form:denied-A:new", { title: "" }),
    );
    act(() => first.result.current.setDraft({ title: "Private" }));
    first.unmount();
    const other = renderHook(() =>
      useAccountDraft("focus:form:denied-B:new", { title: "" }),
    );
    expect(other.result.current.draft.title).toBe("");
    other.unmount();
    const restored = renderHook(() =>
      useAccountDraft("focus:form:denied-A:new", { title: "" }),
    );
    expect(restored.result.current.draft.title).toBe("Private");
  } finally {
    deny.mockRestore();
  }
});
it("does not turn successful saves into failures when storage removal is denied", async () => {
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  const execute = vi.fn().mockResolvedValue({});
  const saved = vi.fn();
  render(
    <TaskEditor
      owner="remove-owner"
      zone="UTC"
      groups={[]}
      disabled={false}
      execute={execute}
      onSaved={saved}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Save me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(screen.queryByText("Denied")).not.toBeInTheDocument();
});

it("resets form values on an account change without copying the former account draft", () => {
  const { result, rerender } = renderHook(
    ({ owner }) => useAccountDraft(`focus:form:${owner}:switch`, { title: "" }),
    { initialProps: { owner: "switch-A" } },
  );
  act(() => result.current.setDraft({ title: "Only A" }));
  rerender({ owner: "switch-B" });
  expect(result.current.draft.title).toBe("");
  expect(sessionStorage.getItem("focus:form:switch-B:switch")).not.toContain(
    "Only A",
  );
});

it("announces reload limitations accessibly when storage fails", async () => {
  const { Providers } = await import("../src/app/providers");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 401 }),
  );
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  function Draft() {
    useAccountDraft("focus:form:warning:new", "draft");
    return <span>Working</span>;
  }
  render(
    <Providers>
      <Draft />
    </Providers>,
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    /reload|refresh/i,
  );
  expect(screen.getByText("Working")).toBeVisible();
});
