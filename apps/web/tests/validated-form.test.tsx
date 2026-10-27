import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ValidatedForm } from "../src/components/validated-form";
it("shows an accessible custom error and prevents an invalid submission", () => {
  const submit = vi.fn((e) => e.preventDefault());
  render(
    <ValidatedForm onSubmit={submit}>
      <label>
        Task title
        <input required />
      </label>
      <button>Create</button>
    </ValidatedForm>,
  );
  fireEvent.click(screen.getByText("Create"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Task title is required.",
  );
  expect(screen.getByLabelText("Task title")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("Task title").nextElementSibling).toBe(
    screen.getByRole("alert"),
  );
  expect(submit).not.toHaveBeenCalled();
  fireEvent.input(screen.getByLabelText("Task title"), {
    target: { value: "Read" },
  });
  fireEvent.click(screen.getByText("Create"));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
