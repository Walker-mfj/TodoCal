import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TimerClock } from "./timerClock";
it("keeps confirmation text but stops its indicator after settlement fails, restarting only for retry", () => {
  const props = {
    seconds: 0,
    ratio: 1,
    active: { status: "running" } as any,
    connected: true,
  };
  const { container, rerender } = render(
    <TimerClock {...props} settlementPending={false} />,
  );
  expect(screen.getByText("Confirming completion…")).toBeInTheDocument();
  expect(container.querySelector("small svg")).toBeNull();
  rerender(<TimerClock {...props} settlementPending />);
  expect(container.querySelector("small svg")).not.toBeNull();
  rerender(<TimerClock {...props} settlementPending connected={false} />);
  expect(container.querySelector("small svg")).toBeNull();
});
