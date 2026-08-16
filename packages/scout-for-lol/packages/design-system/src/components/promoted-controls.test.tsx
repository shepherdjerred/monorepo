import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog.tsx";
import { Avatar, AvatarFallback } from "./avatar.tsx";
import { Button } from "./button.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer.tsx";
import { ScoutPortalProvider } from "./portal.tsx";
import { Progress } from "./progress.tsx";
import { ScrollArea } from "./scroll-area.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.tsx";
import { Toaster, toast } from "./toaster.tsx";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.tsx";
import { ScoutThemeProvider } from "#src/runtime/context.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.style.pointerEvents = "";
});

function portalRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("#test-portal-root");
  if (root === null) throw new Error("Missing test portal root");
  return root;
}

describe("promoted Scout controls", () => {
  test("portaled controls default to document.body without a provider", () => {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Default portal</AlertDialogTitle>
          <AlertDialogDescription>Body fallback</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(
      screen.getByRole("alertdialog", { name: "Default portal" }),
    ).toBeTruthy();
    expect(portalRoot().querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("alert dialog renders in the supplied portal with alert semantics and restores focus", async () => {
    const user = userEvent.setup();
    const container = portalRoot();
    render(
      <ScoutPortalProvider container={container}>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button>Delete night</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Delete this night?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ScoutPortalProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Delete night" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(
      within(container).getByRole("alertdialog", {
        name: "Delete this night?",
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(trigger);
  });

  test("drawer opens inside the supplied portal and dismisses by keyboard", async () => {
    const user = userEvent.setup();
    const container = portalRoot();
    render(
      <ScoutPortalProvider container={container}>
        <Drawer showSwipeHandle>
          <DrawerTrigger render={<Button />}>Open mobile roster</DrawerTrigger>
          <DrawerContent>
            <DrawerTitle>Mobile roster</DrawerTitle>
            <DrawerDescription>Ten eligible players</DrawerDescription>
          </DrawerContent>
        </Drawer>
      </ScoutPortalProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Open mobile roster" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(
      within(container).getByRole("dialog", { name: "Mobile roster" }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  test("select and toggle group expose controlled keyboard-operable state", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Select defaultValue="ready">
          <SelectTrigger aria-label="Availability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="maybe">Maybe</SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup type="single" defaultValue="ready">
          <ToggleGroupItem value="ready">Ready</ToggleGroupItem>
          <ToggleGroupItem value="maybe">Maybe</ToggleGroupItem>
        </ToggleGroup>
      </>,
    );

    const select = screen.getByRole("combobox", { name: "Availability" });
    select.focus();
    await user.keyboard("{Enter}{ArrowDown}{Enter}");
    expect(select.textContent).toContain("Maybe");

    const maybe = screen.getByRole("radio", { name: "Maybe" });
    await user.click(maybe);
    expect(maybe.dataset["state"]).toBe("on");
  });

  test("avatar, progress, scroll area, tooltip, and toaster retain accessible output", async () => {
    const user = userEvent.setup();
    const container = portalRoot();
    render(
      <ScoutThemeProvider surface="activity">
        <ScoutPortalProvider container={container}>
          <Avatar>
            <AvatarFallback>JP</AvatarFallback>
          </Avatar>
          <Progress aria-label="Roster completion" value={70} />
          <ScrollArea style={{ height: 40 }}>
            <p>Bench player</p>
          </ScrollArea>
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button>Roster help</Button>
              </TooltipTrigger>
              <TooltipContent>First ten ready players</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            onClick={() => {
              toast.success("Night created");
            }}
          >
            Create toast
          </Button>
          <Toaster />
        </ScoutPortalProvider>
      </ScoutThemeProvider>,
    );

    expect(screen.getByText("JP")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "70",
    );
    expect(screen.getByText("Bench player")).toBeTruthy();
    fireEvent.focus(screen.getByRole("button", { name: "Roster help" }));
    const tooltip = await within(container).findByRole("tooltip");
    expect(tooltip.textContent).toBe("First ten ready players");
    await user.click(screen.getByRole("button", { name: "Create toast" }));
    expect(await screen.findByText("Night created")).toBeTruthy();
  });
});
