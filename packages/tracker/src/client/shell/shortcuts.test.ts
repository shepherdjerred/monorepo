import { describe, expect, test } from "vitest";
import { createRecentIssues } from "./recent-issues.ts";
import { bindingId, resolveShortcut, shortcuts } from "./shortcuts.ts";

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  code: modifiers.code ?? "",
  metaKey: modifiers.metaKey ?? false,
  ctrlKey: modifiers.ctrlKey ?? false,
  altKey: modifiers.altKey ?? false,
  shiftKey: modifiers.shiftKey ?? false,
});

describe("shortcut registry", () => {
  test("no two shortcuts share a binding or an action", () => {
    const bindings = shortcuts.map(({ binding }) => bindingId(binding));
    expect(new Set(bindings).size).toBe(bindings.length);
    const actions = shortcuts.map(({ action }) => action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  test("a key that starts a sequence is never also a shortcut of its own", () => {
    const starts = shortcuts.flatMap(({ binding }) =>
      binding.type === "sequence" ? [binding.keys[0]] : [],
    );
    for (const start of starts) {
      expect(resolveShortcut(press(start), undefined).shortcut).toBeUndefined();
    }
  });

  test("plain keys, Shift keys and sequences resolve to their actions", () => {
    expect(resolveShortcut(press("x"), undefined).shortcut?.action).toBe("x");
    expect(
      resolveShortcut(press("J", { shiftKey: true }), undefined).shortcut
        ?.action,
    ).toBe("J");
    expect(
      resolveShortcut(press("C", { shiftKey: true }), undefined).shortcut
        ?.action,
    ).toBe("C");
    expect(resolveShortcut(press("g"), undefined)).toEqual({ start: "g" });
    expect(resolveShortcut(press("i"), "g").shortcut?.action).toBe("gi");
    expect(resolveShortcut(press("i"), undefined).shortcut?.action).toBe("i");
  });

  test("only the registered chords are taken from the browser", () => {
    const mod = { metaKey: true };
    expect(
      resolveShortcut(press("k", { ...mod, code: "KeyK" }), undefined).shortcut
        ?.action,
    ).toBe("palette");
    expect(
      resolveShortcut(press(".", { ...mod, code: "Period" }), undefined)
        .shortcut?.action,
    ).toBe("copyId");
    expect(
      resolveShortcut(
        press("<", { ...mod, shiftKey: true, code: "Comma" }),
        undefined,
      ).shortcut?.action,
    ).toBe("copyLink");
    expect(
      resolveShortcut(press("a", { ctrlKey: true, code: "KeyA" }), undefined)
        .shortcut?.action,
    ).toBe("selectAll");
    // Copy, paste, browser back and Alt chords stay with the browser.
    for (const [key = "", code = ""] of [
      ["c", "KeyC"],
      ["v", "KeyV"],
      ["[", "BracketLeft"],
      [",", "Comma"],
    ]) {
      expect(resolveShortcut(press(key, { ...mod, code }), undefined)).toEqual(
        {},
      );
    }
    expect(resolveShortcut(press("c", { altKey: true }), undefined)).toEqual(
      {},
    );
  });

  test("editor chords are listed for the help sheet but left to their dialog", () => {
    const local = shortcuts.filter((shortcut) => shortcut.local === true);
    expect(local.map(({ keys }) => keys)).toEqual(["⌘ Enter", "⌘ ⇧ Enter"]);
  });
});

describe("recent issues", () => {
  test("the palette keeps the last eight issues opened, newest first", () => {
    const values = new Map<string, string>();
    const recent = createRecentIssues(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    }));
    for (let number = 1; number <= 10; number += 1) {
      recent.remember({ identifier: `AI-${String(number)}`, title: "t" });
    }
    recent.remember({ identifier: "AI-5", title: "reopened" });
    const listed = recent.read();
    expect(listed).toHaveLength(8);
    expect(listed[0]).toEqual({ identifier: "AI-5", title: "reopened" });
    expect(listed.map(({ identifier }) => identifier)).not.toContain("AI-1");
  });
});
