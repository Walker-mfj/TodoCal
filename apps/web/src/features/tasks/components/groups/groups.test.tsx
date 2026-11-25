import { it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Groups } from "./groups";
import { ApiError } from "../../../../shared/api/apiClient";
it("preserves group draft and retry key only for its owner after expiration", async () => {
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(401, "Expired"))
    .mockResolvedValue({});
  const first = render(
    <Groups owner="A" groups={[]} execute={execute} disabled={false} />,
  );
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "Private group" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create group" }));
  await screen.findByRole("alert");
  first.unmount();
  const other = render(
    <Groups owner="B" groups={[]} execute={execute} disabled={false} />,
  );
  expect(screen.getByLabelText("Group name")).toHaveValue("");
  other.unmount();
  render(<Groups owner="A" groups={[]} execute={execute} disabled={false} />);
  expect(screen.getByLabelText("Group name")).toHaveValue("Private group");
  fireEvent.click(screen.getByRole("button", { name: "Retry request" }));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(execute.mock.calls[1][1]).toEqual(execute.mock.calls[0][1]);
});

it.each([true, false])(
  "keeps the group save indicator until settlement (success: %s)",
  async (success) => {
    let settle!: () => void;
    const execute = vi.fn().mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settle = () =>
            success ? resolve({}) : reject(new ApiError(400, "Save failed"));
        }),
    );
    render(
      <Groups
        owner="pending-group"
        groups={[
          {
            id: "group-a",
            name: "Group A",
            color: "#4169b1",
            revision: 1,
          },
        ]}
        execute={execute}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const save = screen.getByRole("button", { name: "Save group" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(save);
    expect(cancel).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(save.querySelector("svg")).not.toBeNull();
    fireEvent.click(cancel);
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Group name")).toHaveValue("Group A");
    await act(async () => settle());
    expect(save).toHaveAttribute("aria-busy", "false");
    expect(save.querySelector("svg")).toBeNull();
    if (success) {
      expect(screen.getByRole("button", { name: "Create group" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    } else {
      expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
      expect(cancel).toBeEnabled();
    }
  },
);
