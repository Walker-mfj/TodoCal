import { it, expect } from "vitest";
import { remainingSeconds } from "../src/features/focus/clock";
it("extrapolates running time, freezes pauses and caps at zero", () => {
  expect(
    remainingSeconds(
      { targetSeconds: 1500, elapsedSeconds: 600, status: "running" },
      1000,
      11000,
    ),
  ).toBe(890);
  expect(
    remainingSeconds(
      { targetSeconds: 1500, elapsedSeconds: 600, status: "paused" },
      1000,
      61000,
    ),
  ).toBe(900);
  expect(
    remainingSeconds(
      { targetSeconds: 1500, elapsedSeconds: 1499, status: "running" },
      1000,
      61000,
    ),
  ).toBe(0);
});
