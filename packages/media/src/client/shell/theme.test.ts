import { afterEach, beforeEach, expect, test, vi } from "vitest";

const LIGHT = "#f3f5ee";
const DARK = "#141918";

/** The parts of a page the theme touches: the root, two metas, storage. */
function page(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const dataset: Record<string, string> = {};
  const metas = { light: { content: LIGHT }, dark: { content: DARK } };
  const handlers: (() => void)[] = [];
  vi.stubGlobal("document", {
    documentElement: { dataset },
    querySelector: (selector: string) =>
      selector.includes("prefers-color-scheme: light")
        ? metas.light
        : metas.dark,
  });
  vi.stubGlobal("addEventListener", (type: string, handler: () => void) => {
    if (type === "storage") handlers.push(handler);
  });
  vi.stubGlobal("localStorage", storage);
  return {
    pinned: () => dataset["theme"],
    metas,
    /** The `storage` event another tab's write raises in this one. */
    changedElsewhere: () => {
      for (const handler of handlers) handler();
    },
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const blockedStorage = {
  getItem: () => {
    throw new Error("Storage is blocked");
  },
  setItem: () => {
    throw new Error("Storage is blocked");
  },
  removeItem: () => {
    throw new Error("Storage is blocked");
  },
};

beforeEach(() => {
  // The choice is module state; every test starts from a fresh page load.
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("a page with nothing stored follows the device", async () => {
  const view = page(memoryStorage());
  const { initializeTheme } = await import("./theme.ts");
  initializeTheme();
  expect(view.pinned()).toBeUndefined();
  expect(view.metas).toEqual({
    light: { content: LIGHT },
    dark: { content: DARK },
  });
});

test("a stored theme is pinned before the first render and announced for both schemes", async () => {
  const view = page(memoryStorage({ "media.theme": "dark" }));
  const { initializeTheme } = await import("./theme.ts");
  initializeTheme();
  expect(view.pinned()).toBe("dark");
  expect(view.metas).toEqual({
    light: { content: DARK },
    dark: { content: DARK },
  });
});

test("choosing a theme pins and stores it; choosing System forgets it", async () => {
  const storage = memoryStorage();
  const view = page(storage);
  const { chooseTheme, initializeTheme, THEME_STORAGE_KEY } =
    await import("./theme.ts");
  initializeTheme();

  chooseTheme("light");
  expect(view.pinned()).toBe("light");
  expect(view.metas.dark.content).toBe(LIGHT);
  expect(storage.values.get(THEME_STORAGE_KEY)).toBe("light");

  chooseTheme("system");
  expect(view.pinned()).toBeUndefined();
  expect(view.metas).toEqual({
    light: { content: LIGHT },
    dark: { content: DARK },
  });
  expect(storage.values.has(THEME_STORAGE_KEY)).toBe(false);
});

test("a theme still applies when storage throws", async () => {
  const view = page(blockedStorage);
  const { chooseTheme, initializeTheme } = await import("./theme.ts");
  initializeTheme();
  expect(view.pinned()).toBeUndefined();
  chooseTheme("dark");
  expect(view.pinned()).toBe("dark");
  expect(view.metas.light.content).toBe(DARK);
});

test("a choice made in another tab applies here", async () => {
  const storage = memoryStorage();
  const view = page(storage);
  const { initializeTheme, THEME_STORAGE_KEY } = await import("./theme.ts");
  initializeTheme();
  // Some other key changed.
  view.changedElsewhere();
  expect(view.pinned()).toBeUndefined();
  storage.values.set(THEME_STORAGE_KEY, "dark");
  view.changedElsewhere();
  expect(view.pinned()).toBe("dark");
  expect(view.metas.light.content).toBe(DARK);
  // Site data was cleared.
  storage.values.clear();
  view.changedElsewhere();
  expect(view.pinned()).toBeUndefined();
});

test("a stored value that is not a theme follows the device", async () => {
  const view = page(memoryStorage({ "media.theme": "sepia" }));
  const { initializeTheme } = await import("./theme.ts");
  initializeTheme();
  expect(view.pinned()).toBeUndefined();
});
