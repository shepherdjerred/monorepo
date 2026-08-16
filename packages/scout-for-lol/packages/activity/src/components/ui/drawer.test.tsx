import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

afterEach(cleanup);

describe("Activity Drawer wrapper", () => {
  test("opens by keyboard inside the safe-area portal and restores focus", async () => {
    const user = userEvent.setup();
    render(
      <Drawer>
        <DrawerTrigger render={<Button />}>Open mobile details</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Mobile player details</DrawerTitle>
          <DrawerDescription>Private Customs information</DrawerDescription>
        </DrawerContent>
      </Drawer>,
    );
    const trigger = screen.getByRole("button", { name: "Open mobile details" });
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
