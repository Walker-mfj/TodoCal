import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
