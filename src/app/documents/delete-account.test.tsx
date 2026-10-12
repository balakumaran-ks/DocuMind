import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteAccount } from "./delete-account";

afterEach(cleanup);

function setup() {
  const action = vi.fn(async () => undefined);
  render(<DeleteAccount action={action} />);
  return { action, user: userEvent.setup() };
}

describe("DeleteAccount", () => {
  it("asks for confirmation, saying what will be deleted, before deleting anything", async () => {
    const { action, user } = setup();
    expect(screen.queryByRole("button", { name: /delete everything/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    expect(document.body.textContent).toMatch(/documents, chats and your profile/i);
    expect(screen.getByRole("button", { name: /delete everything/i })).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it("can be cancelled", async () => {
    const { action, user } = setup();
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("button", { name: /delete everything/i })).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it("deletes once confirmed", async () => {
    const { action, user } = setup();
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    await user.click(screen.getByRole("button", { name: /delete everything/i }));

    expect(action).toHaveBeenCalledTimes(1);
  });
});
