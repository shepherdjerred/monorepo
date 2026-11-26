import { describe, expect, test } from "vitest";
import {
  createShortcutRegistry,
  type ShortcutEvent,
} from "@shepherdjerred/console-ui/components/keyboard/shortcut-registry.ts";
import {
  ariaKeyshortcuts,
  bindingId,
  formatShortcut,
  matchesChord,
  parseShortcut,
} from "@shepherdjerred/console-ui/components/keyboard/shortcut-keys.ts";

function press(
  key: string,
  extra: Partial<Omit<ShortcutEvent, "preventDefault">> = {},
): ShortcutEvent & { prevented: () => boolean } {
  let prevented = false;
  return {
    key,
    code:
      extra.code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key),
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: /^[A-Z?]$/.test(key),
    target: null,
    defaultPrevented: false,
    ...extra,
    preventDefault: () => {
      prevented = true;
    },
    prevented: () => prevented,
  };
}

describe("parseShortcut", () => {
  test("reads one key, a sequence and a chord", () => {
    expect(parseShortcut("?")).toEqual({ kind: "key", key: "?" });
    expect(parseShortcut("g i")).toEqual({
      kind: "sequence",
      keys: ["g", "i"],
    });
    expect(parseShortcut("Mod+Shift+K")).toEqual({
      kind: "chord",
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
      key: "KeyK",
      by: "code",
    });
    expect(parseShortcut("Mod+Enter")).toMatchObject({
      key: "Enter",
      by: "key",
    });
    expect(parseShortcut("Mod+.")).toMatchObject({ key: "Period", by: "code" });
  });

  test("throws on a malformed shortcut", () => {
    expect(() => parseShortcut("")).toThrow(/at least one key/);
    expect(() => parseShortcut("Hyper+K")).toThrow(/Unknown modifier/);
  });

  test("gives each binding one identity", () => {
    expect(bindingId(parseShortcut("Mod+K"))).toBe(
      bindingId(parseShortcut("Meta+k")),
    );
    expect(bindingId(parseShortcut("g i"))).toBe("sequence:g i");
  });
});

describe("matchesChord", () => {
  const modK = parseShortcut("Mod+K");
  if (modK.kind !== "chord") throw new Error("Mod+K is a chord");

  test("accepts ⌘ or Ctrl and the physical key", () => {
    expect(matchesChord(modK, press("k", { metaKey: true }))).toBe(true);
    expect(matchesChord(modK, press("k", { ctrlKey: true }))).toBe(true);
    // Option changes the character, not the key.
    expect(
      matchesChord(modK, press("˚", { metaKey: true, code: "KeyK" })),
    ).toBe(true);
  });

  test("rejects a missing or extra modifier", () => {
    expect(matchesChord(modK, press("k"))).toBe(false);
    expect(
      matchesChord(modK, press("K", { metaKey: true, shiftKey: true })),
    ).toBe(false);
  });
});

describe("formatShortcut and ariaKeyshortcuts", () => {
  test("show one keycap per key, per platform", () => {
    expect(formatShortcut("Mod+K", true)).toEqual(["⌘", "K"]);
    expect(formatShortcut("Mod+K", false)).toEqual(["Ctrl", "K"]);
    expect(formatShortcut("Mod+Shift+,", true)).toEqual(["⌘", "⇧", ","]);
    expect(formatShortcut("P", true)).toEqual(["⇧", "P"]);
    expect(formatShortcut("g i", true)).toEqual(["G", "I"]);
    expect(formatShortcut("Escape", true)).toEqual(["Esc"]);
  });

  test("name the keys for screen readers; sequences have no form", () => {
    expect(ariaKeyshortcuts("Mod+K")).toBe("Meta+K Control+K");
    expect(ariaKeyshortcuts("P")).toBe("Shift+P");
    expect(ariaKeyshortcuts("?")).toBe("?");
    expect(ariaKeyshortcuts("g i")).toBeUndefined();
  });
});

function registry(
  options: { blocked?: boolean; time?: { now: number } } = {},
): ReturnType<typeof createShortcutRegistry> {
  const time = options.time ?? { now: 0 };
  return createShortcutRegistry({
    target: null,
    apple: true,
    groups: ["General", "Navigation"],
    isBlocked: () => options.blocked ?? false,
    now: () => time.now,
  });
}

describe("createShortcutRegistry", () => {
  test("runs a one-key shortcut and takes the key from the browser", () => {
    const shortcuts = registry();
    const ran: string[] = [];
    shortcuts.register({
      id: "help",
      keys: "?",
      description: "Keyboard shortcuts",
      group: "General",
      run: () => ran.push("help"),
    });
    const event = press("?");
    expect(shortcuts.handleKeyDown(event)).toBe(true);
    expect(event.prevented()).toBe(true);
    expect(ran).toEqual(["help"]);
  });

  test("leaves the key alone when run returns false", () => {
    const shortcuts = registry();
    shortcuts.register({
      id: "next",
      keys: "j",
      description: "Next",
      group: "Navigation",
      run: () => false,
    });
    const event = press("j");
    expect(shortcuts.handleKeyDown(event)).toBe(false);
    expect(event.prevented()).toBe(false);
  });

  test("runs a two-key sequence typed in time, and not after it", () => {
    const time = { now: 0 };
    const shortcuts = registry({ time });
    const ran: string[] = [];
    shortcuts.register([
      {
        id: "go-issues",
        keys: "g i",
        description: "Go to issues",
        group: "Navigation",
        run: () => ran.push("gi"),
      },
      {
        id: "info",
        keys: "i",
        description: "Info",
        group: "General",
        run: () => ran.push("i"),
      },
    ]);
    expect(shortcuts.handleKeyDown(press("g"))).toBe(false);
    time.now = 500;
    expect(shortcuts.handleKeyDown(press("i"))).toBe(true);
    expect(ran).toEqual(["gi"]);
    shortcuts.handleKeyDown(press("g"));
    time.now = 2000;
    shortcuts.handleKeyDown(press("i"));
    expect(ran).toEqual(["gi", "i"]);
  });

  test("runs a chord with ⌘ or Ctrl", () => {
    const shortcuts = registry();
    let count = 0;
    shortcuts.register({
      id: "palette",
      keys: "Mod+K",
      description: "Search and commands",
      group: "General",
      run: () => (count += 1),
    });
    shortcuts.handleKeyDown(press("k", { metaKey: true }));
    shortcuts.handleKeyDown(press("k", { ctrlKey: true }));
    shortcuts.handleKeyDown(press("k"));
    expect(count).toBe(2);
  });

  test("an open dialog blocks shortcuts unless they work anywhere", () => {
    const shortcuts = registry({ blocked: true });
    const ran: string[] = [];
    shortcuts.register([
      {
        id: "create",
        keys: "c",
        description: "Create",
        group: "General",
        run: () => ran.push("c"),
      },
      {
        id: "palette",
        keys: "Mod+K",
        description: "Search",
        group: "General",
        anywhere: true,
        run: () => ran.push("palette"),
      },
    ]);
    shortcuts.handleKeyDown(press("c"));
    shortcuts.handleKeyDown(press("k", { metaKey: true }));
    expect(ran).toEqual(["palette"]);
  });

  test("ignores a key another handler already took", () => {
    const shortcuts = registry();
    let ran = false;
    shortcuts.register({
      id: "c",
      keys: "c",
      description: "Create",
      group: "General",
      run: () => (ran = true),
    });
    shortcuts.handleKeyDown(press("c", { defaultPrevented: true }));
    expect(ran).toBe(false);
  });
});

describe("createShortcutRegistry scopes and help sheet", () => {
  test("scoped shortcuts work only while their scope is active", () => {
    const shortcuts = registry();
    let count = 0;
    shortcuts.register({
      id: "select",
      keys: "x",
      description: "Select row",
      group: "General",
      scope: "list",
      run: () => (count += 1),
    });
    shortcuts.handleKeyDown(press("x"));
    const release = shortcuts.activateScope("list");
    shortcuts.handleKeyDown(press("x"));
    expect(shortcuts.sheet()[0]?.shortcuts.map(({ id }) => id)).toEqual([
      "select",
    ]);
    release();
    shortcuts.handleKeyDown(press("x"));
    expect(count).toBe(1);
    expect(shortcuts.sheet()).toEqual([]);
  });

  test("refuses two shortcuts on one binding, or one id twice", () => {
    const shortcuts = registry();
    shortcuts.register({
      id: "a",
      keys: "a",
      description: "A",
      group: "General",
    });
    expect(() =>
      shortcuts.register({
        id: "b",
        keys: "a",
        description: "B",
        group: "General",
      }),
    ).toThrow(/clashes/);
    expect(() =>
      shortcuts.register({
        id: "a",
        keys: "z",
        description: "Z",
        group: "General",
      }),
    ).toThrow(/clashes/);
  });

  test("lists the help sheet by group, with family lines and hints", () => {
    const shortcuts = registry();
    const unregister = shortcuts.register([
      {
        id: "view1",
        keys: "g 1",
        description: "View 1",
        group: "Navigation",
        sheet: { keys: "g 1–9", description: "Go to a saved view" },
      },
      {
        id: "view2",
        keys: "g 2",
        description: "View 2",
        group: "Navigation",
        sheet: false,
      },
      {
        id: "help",
        keys: "?",
        description: "Keyboard shortcuts",
        group: "General",
      },
      { id: "submit", keys: "Mod+Enter", description: "Save", group: "Editor" },
    ]);
    expect(shortcuts.sheet()).toEqual([
      {
        group: "General",
        shortcuts: [
          { id: "help", keys: "?", description: "Keyboard shortcuts" },
        ],
      },
      {
        group: "Navigation",
        shortcuts: [
          { id: "view1", keys: "g 1–9", description: "Go to a saved view" },
        ],
      },
      {
        group: "Editor",
        shortcuts: [{ id: "submit", keys: "Mod+Enter", description: "Save" }],
      },
    ]);
    expect(shortcuts.hint("submit")).toEqual(["⌘", "Enter"]);
    expect(shortcuts.aria("submit")).toBe("Meta+Enter Control+Enter");
    // A listed shortcut without `run` is for reference only.
    expect(shortcuts.handleKeyDown(press("Enter", { metaKey: true }))).toBe(
      false,
    );
    unregister();
    expect(shortcuts.active()).toEqual([]);
  });

  test("listens on its target until destroyed", () => {
    const listeners = new Set<(event: ShortcutEvent) => void>();
    const target = {
      addEventListener: (
        _: "keydown",
        listener: (event: ShortcutEvent) => void,
      ) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _: "keydown",
        listener: (event: ShortcutEvent) => void,
      ) => {
        listeners.delete(listener);
      },
    };
    const shortcuts = createShortcutRegistry({
      target,
      isBlocked: () => false,
    });
    let count = 0;
    shortcuts.register({
      id: "c",
      keys: "c",
      description: "Create",
      group: "General",
      run: () => (count += 1),
    });
    for (const listener of listeners) listener(press("c"));
    shortcuts.destroy();
    expect(listeners.size).toBe(0);
    expect(count).toBe(1);
  });
});
