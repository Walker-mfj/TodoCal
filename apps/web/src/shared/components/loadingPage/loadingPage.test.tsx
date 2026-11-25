import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LoadingPage } from "./loadingPage";
it("exposes one status and busy content without interactive controls", () => {
  const { container } = render(<LoadingPage label="Opening your workspace…" />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain(
    "Opening your workspace…",
  );
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.querySelector("button,input,a")).toBeNull();
});
