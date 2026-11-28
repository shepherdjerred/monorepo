import { CopyIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { KeyHint } from "@shepherdjerred/console-ui/components/keyboard/key-hint.tsx";
import {
  ContextMenu,
  isContextMenuKey,
} from "@shepherdjerred/console-ui/components/overlays/context-menu.tsx";
import { leavingPopup } from "@shepherdjerred/console-ui/components/overlays/leaving-popup.tsx";
import {
  Menu,
  MenuItem,
} from "@shepherdjerred/console-ui/components/overlays/menu.tsx";
import { Popover } from "@shepherdjerred/console-ui/components/overlays/popover.tsx";
import { Sheet } from "@shepherdjerred/console-ui/components/overlays/sheet.tsx";
import { toast } from "@shepherdjerred/console-ui/components/overlays/toast.tsx";
import {
  ActorChip,
  Avatar,
  initials,
} from "@shepherdjerred/console-ui/components/people/avatar.tsx";

const noop = (): void => {
  // Nothing to undo in a test.
};

/*
 * Static markup covers names, roles and closed state. Opening, focus and
 * keyboard need a real browser: Hub's `e2e/kit.spec.ts` drives every piece
 * in Chromium.
 */

describe("Menu", () => {
  const html = renderToStaticMarkup(
    <Menu trigger={<Button>Actions</Button>} label="Actions for AI-12">
      <MenuItem icon={CopyIcon} shortcut="Mod+.">
        Copy ID
      </MenuItem>
    </Menu>,
  );

  test("renders a closed menu button on the trigger", () => {
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="ui-btn"');
    expect(html).toContain(">Actions</button>");
  });

  test("keeps the closed popup out of the page", () => {
    expect(html).not.toContain("Copy ID");
  });
});

describe("ContextMenu", () => {
  test("wraps its target and leaves the menu closed", () => {
    const html = renderToStaticMarkup(
      <ContextMenu label="Actions for AI-12" menu={<MenuItem>Copy</MenuItem>}>
        <span>AI-12</span>
      </ContextMenu>,
    );
    expect(html).toContain("<span>AI-12</span>");
    expect(html).not.toContain("Copy");
  });

  test("opens from Shift+F10 and the Menu key", () => {
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(
      true,
    );
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).toBe(false);
  });
});

describe("Popover", () => {
  test("marks its trigger as opening a dialog", () => {
    const html = renderToStaticMarkup(
      <Popover trigger={<Button>Display</Button>} title="Display">
        <p>Options</p>
      </Popover>,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Options");
  });
});

describe("Sheet", () => {
  test("renders only its trigger while closed", () => {
    const html = renderToStaticMarkup(
      <Sheet title="More" side="bottom" trigger={<Button>More</Button>}>
        <p>Links</p>
      </Sheet>,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("Links");
  });
});

describe("leavingPopup", () => {
  test("makes a closing popup inert and hidden from assistive technology", () => {
    const closing = renderToStaticMarkup(
      leavingPopup({ className: "ui-menu" }, { open: false }),
    );
    expect(closing).toBe(
      '<div class="ui-menu" aria-hidden="true" inert=""></div>',
    );
    const open = renderToStaticMarkup(
      leavingPopup({ className: "ui-menu" }, { open: true }),
    );
    expect(open).toBe('<div class="ui-menu"></div>');
  });
});

describe("toast", () => {
  test("returns an id for every kind, so it can be dismissed", () => {
    const ids = [
      toast.notify("Saved go/ha"),
      toast.error("Could not save"),
      toast.undo("Archived AI-12", { undo: noop }),
    ];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) toast.dismiss(id);
  });

  test("runs the newest undo once, from ⌘Z", () => {
    const undone: string[] = [];
    toast.undo("Archived AI-1", { undo: () => undone.push("AI-1") });
    toast.undo("Archived AI-2", { undo: () => undone.push("AI-2") });
    expect(toast.undoLatest()).toBe(true);
    expect(toast.undoLatest()).toBe(true);
    expect(undone).toEqual(["AI-2", "AI-1"]);
  });
});

describe("KeyHint", () => {
  test("draws one keycap per key and can hide from assistive technology", () => {
    expect(renderToStaticMarkup(<KeyHint keys={["⌘", "K"]} decorative />)).toBe(
      '<span class="ui-keys" aria-hidden="true"><kbd class="ui-kbd">⌘</kbd><kbd class="ui-kbd">K</kbd></span>',
    );
    expect(renderToStaticMarkup(<KeyHint keys="g i" />)).toBe(
      '<span class="ui-keys"><kbd class="ui-kbd">G</kbd><kbd class="ui-kbd">I</kbd></span>',
    );
  });
});

describe("Avatar and ActorChip", () => {
  test("initials come from the first two words", () => {
    expect(initials("Jerred Shepherd")).toBe("JS");
    expect(initials("claude")).toBe("C");
    expect(initials("ci-driver.bot")).toBe("CD");
  });

  test("an avatar names its person, or hides when decorative", () => {
    const named = renderToStaticMarkup(
      <Avatar name="Jerred Shepherd" size={24} />,
    );
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Jerred Shepherd"');
    expect(named).toContain('data-size="24"');
    expect(named).toContain(">JS</span>");
    const decorative = renderToStaticMarkup(
      <Avatar name="Claude" decorative />,
    );
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain("role=");
  });

  test("an actor chip is a tag chip with a 16px avatar and the name", () => {
    const html = renderToStaticMarkup(<ActorChip name="Claude" kind="agent" />);
    expect(html).toMatch(/^<span class="ui-chip" data-kind="tag">/);
    expect(html).toContain('data-size="16"');
    expect(html).toContain('<span class="ui-actor-name">Claude</span>');
    expect(html).toContain('<span class="ui-actor-kind">agent</span>');
  });
});
