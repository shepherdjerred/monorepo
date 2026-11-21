// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  RowMenu,
  type MenuItem,
} from "@shepherdjerred/streambot/web/client/media/row-menu.tsx";
import {
  button,
  click,
  mount,
  press,
  settle,
  type Mounted,
} from "./harness.ts";

const chosen: string[] = [];
const ITEMS: MenuItem[] = ["Listen next", "Watch next", "Watch now"].map(
  (label) => ({
    key: label,
    label,
    onSelect: () => {
      chosen.push(label);
    },
  }),
);

let view: Mounted;

afterEach(async () => {
  await view.unmount();
  chosen.length = 0;
  vi.restoreAllMocks();
});

function trigger(): HTMLButtonElement {
  return button(view.container, "More ways to play");
}

function focused(): string | null {
  const active = document.activeElement;
  return active instanceof HTMLElement
    ? (active.getAttribute("aria-label") ?? active.textContent)
    : null;
}

function menuOpen(): boolean {
  return view.container.querySelector('[role="menu"]') !== null;
}

/** Presses `key` wherever focus is, as a keyboard user would. */
async function key(name: string) {
  await press(document.activeElement, name);
  await settle();
}

async function openWithKeyboard(pending = false) {
  view = await mount(
    <RowMenu label="More ways to play" items={ITEMS} pending={pending} />,
  );
  trigger().focus();
  await key("ArrowDown");
}

describe("RowMenu keyboard", () => {
  test("ArrowDown on the trigger opens the menu on its first item", async () => {
    await openWithKeyboard();
    expect(menuOpen()).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe("Listen next");
  });

  test("arrows move and wrap; Home and End jump to the ends", async () => {
    await openWithKeyboard();
    await key("ArrowDown");
    expect(focused()).toBe("Watch next");
    await key("End");
    expect(focused()).toBe("Watch now");
    await key("ArrowDown");
    expect(focused()).toBe("Listen next");
    await key("ArrowUp");
    expect(focused()).toBe("Watch now");
    await key("Home");
    expect(focused()).toBe("Listen next");
  });

  test("Escape closes the menu and returns focus to the trigger", async () => {
    await openWithKeyboard();
    await key("ArrowDown");
    await key("Escape");
    expect(menuOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  test("Tab closes the menu", async () => {
    await openWithKeyboard();
    await key("Tab");
    expect(menuOpen()).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  test("choosing an item runs it once, closes the menu and refocuses the trigger", async () => {
    await openWithKeyboard();
    await key("ArrowDown");
    await click(document.activeElement);
    expect(chosen).toEqual(["Watch next"]);
    expect(menuOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  test("while an action is pending the trigger is busy and does not open", async () => {
    await openWithKeyboard(true);
    expect(menuOpen()).toBe(false);
    await click(trigger());
    expect(menuOpen()).toBe(false);
    expect(trigger().getAttribute("aria-busy")).toBe("true");
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
    expect(trigger().disabled).toBe(false);
  });
});
