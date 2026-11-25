import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";
describe("Skeleton", () => {
  it("reserves dimensions without exposing fake content or controls", () => {
    const { container } = render(
      <Skeleton width={48} height={48} variant="circle" />,
    );
    const element = container.firstElementChild as HTMLElement;
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.style.width).toBe("48px");
    expect(element.style.height).toBe("48px");
    expect(container.querySelector("button,input,[tabindex]")).toBeNull();
  });
});
it("accepts relative inline sizes and defaults to a noninteractive rectangle", () => {
  const { container } = render(<Skeleton width="70%" />);
  const element = container.firstElementChild as HTMLElement;
  expect(element.style.width).toBe("70%");
  expect(element.style.height).toBe("16px");
  expect(element.textContent).toBe("");
});
