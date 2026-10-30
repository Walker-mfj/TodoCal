import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ToastProvider, ToastNotice } from "./toast";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test("success expires after 3 seconds; warning remains for 6; error persists", () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <ToastNotice tone="success">Saved</ToastNotice>
      <ToastNotice tone="warning">Past days are read-only</ToastNotice>
      <ToastNotice tone="error">Retry needed</ToastNotice>
    </ToastProvider>,
  );
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByText("Saved")).toBeNull();
  expect(screen.getByText("Past days are read-only")).toBeTruthy();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByText("Past days are read-only")).toBeNull();
  expect(screen.getByText("Retry needed")).toBeTruthy();
});
test("queues beyond three notifications and reveals next when dismissed", () => {
  render(
    <ToastProvider>
      {["One", "Two", "Three", "Four"].map((text) => (
        <ToastNotice key={text} duration={0}>
          {text}
        </ToastNotice>
      ))}
    </ToastProvider>,
  );
  expect(
    screen.getAllByRole("button", { name: "Dismiss notification" }),
  ).toHaveLength(3);
  expect(screen.queryByText("Four")).toBeNull();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Dismiss notification" })[0],
  );
  expect(screen.getByText("Four")).toBeTruthy();
});
test("hover pauses dismissal and actions use current callback", () => {
  vi.useFakeTimers();
  const action = vi.fn();
  render(
    <ToastProvider>
      <ToastNotice tone="success">
        Saved<button onClick={action}>Undo</button>
      </ToastNotice>
    </ToastProvider>,
  );
  fireEvent.mouseEnter(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(10000));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(action).toHaveBeenCalledOnce();
  fireEvent.mouseLeave(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByText("Saved")).toBeNull();
});
test("closing a source removes its persistent toast", () => {
  const view = render(
    <ToastProvider>
      <ToastNotice tone="error">Connection lost</ToastNotice>
    </ToastProvider>,
  );
  view.rerender(<ToastProvider>{null}</ToastProvider>);
  expect(screen.queryByText("Connection lost")).toBeNull();
});

test("countdown shrinks, retains remaining time, and waits for both hover and focus to leave", () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <ToastNotice tone="success">Timed</ToastNotice>
      <ToastNotice tone="error">Persistent</ToastNotice>
    </ToastProvider>,
  );
  const toast = screen.getByRole("status");
  const bar = toast.querySelector<HTMLElement>(".toast-countdown > span")!;
  expect(
    screen.getByRole("alert").querySelector(".toast-countdown"),
  ).toBeNull();
  expect(bar.style.transform).toBe("scaleX(1)");
  act(() => vi.advanceTimersByTime(1500));
  expect(bar.style.transform).toBe("scaleX(0.5)");
  fireEvent.mouseEnter(toast);
  fireEvent.focus(
    screen.getAllByRole("button", { name: "Dismiss notification" })[0],
  );
  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(5000));
  expect(bar.style.transform).toBe("scaleX(0.5)");
  fireEvent.blur(
    screen.getAllByRole("button", { name: "Dismiss notification" })[0],
  );
  act(() => vi.advanceTimersByTime(1450));
  expect(screen.getByText("Timed")).toBeTruthy();
  act(() => vi.advanceTimersByTime(50));
  expect(screen.queryByText("Timed")).toBeNull();
});
