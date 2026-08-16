import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

afterEach(cleanup);

describe("Activity Base UI wrappers", () => {
  test("opens by keyboard inside the safe-area portal and restores focus", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger render={<Button />}>Open player details</DialogTrigger>
        <DialogContent>
          <DialogTitle>Player details</DialogTitle>
          <DialogDescription>Private Customs information</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open player details" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const overlayRoot = document.querySelector<HTMLElement>(
      "#activity-overlay-root",
    );
    if (overlayRoot === null) throw new Error("Missing Activity overlay root");
    expect(overlayRoot.querySelector('[role="dialog"]')).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });
});
