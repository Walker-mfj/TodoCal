import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LoadingIndicator } from "./loadingIndicator";
it("is decorative beside existing labels and accessible when standalone", () => {
  const { container, rerender } = render(<LoadingIndicator size={24} />);
  expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect((container.querySelector("svg") as SVGElement).style.width).toBe(
    "24px",
  );
  rerender(<LoadingIndicator label="Saving changes" />);
  expect(screen.getByRole("status").textContent).toBe("Saving changes");
});
