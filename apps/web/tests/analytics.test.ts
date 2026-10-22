import { it, expect } from "vitest";
import { completionRatio, progressLevel } from "../src/lib/model";
it("uses exact counts at color thresholds and reserves full completion for all tasks", () => {
  expect(
    progressLevel(
      completionRatio({ planned: 2000, completed: 999, percentage: 50 }),
    ),
  ).toBe("starting");
  expect(
    progressLevel(
      completionRatio({ planned: 10000, completed: 7999, percentage: 80 }),
    ),
  ).toBe("building");
  expect(
    progressLevel(
      completionRatio({ planned: 10000, completed: 9999, percentage: 99.9 }),
    ),
  ).toBe("strong");
  expect(
    completionRatio({ planned: 2, completed: 2, percentage: null }),
  ).toBeNull();
});
