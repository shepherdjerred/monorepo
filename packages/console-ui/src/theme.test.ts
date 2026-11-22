import { describe, expect, test } from "vitest";
import {
  createThemeStore,
  nextThemePreference,
  parseThemePreference,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui/theme.ts";

type Fake = {
  environment: ThemeEnvironment;
  stored: Map<string, string>;
  dataset: Record<string, string | undefined>;
  setSystemDark: (dark: boolean) => void;
  emitStorage: (key: string | null, value: string | null) => void;
};

function fakeEnvironment(
  options: { stored?: Record<string, string>; broken?: boolean } = {},
): Fake {
  const stored = new Map(Object.entries(options.stored ?? {}));
  const dataset: Record<string, string | undefined> = {};
  const changeListeners: (() => void)[] = [];
  const storageListeners: ((
    key: string | null,
    value: string | null,
  ) => void)[] = [];
  const darkQuery = {
    matches: false,
    addEventListener: (_type: string, listener: () => void) => {
      changeListeners.push(listener);
    },
  };
  const environment: ThemeEnvironment = {
    storage: () => {
      if (options.broken === true) throw new Error("SecurityError");
      return {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => {
          stored.set(key, value);
        },
        removeItem: (key) => {
          stored.delete(key);
        },
      };
    },
    darkQuery,
    root: { dataset },
    onStorage: (listener) => {
      storageListeners.push(listener);
    },
  };
  return {
    environment,
    stored,
    dataset,
    setSystemDark: (dark) => {
      darkQuery.matches = dark;
      for (const listener of changeListeners) listener();
    },
    emitStorage: (key, value) => {
      for (const listener of storageListeners) listener(key, value);
    },
  };
}

describe("parseThemePreference", () => {
  test.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    ["", "system"],
    ["Dark", "system"],
  ] as const)("%s → %s", (input, expected) => {
    expect(parseThemePreference(input)).toBe(expected);
  });
});

test("the cycle runs system → light → dark → system", () => {
  expect(nextThemePreference("system")).toBe("light");
  expect(nextThemePreference("light")).toBe("dark");
  expect(nextThemePreference("dark")).toBe("system");
});

describe("createThemeStore", () => {
  test("applies a stored preference to html[data-theme] on creation", () => {
    const fake = fakeEnvironment({ stored: { "ops-theme": "dark" } });
    const store = createThemeStore("ops-theme", fake.environment);
    expect(store.getPreference()).toBe("dark");
    expect(fake.dataset["theme"]).toBe("dark");
  });

  test("system leaves data-theme unset and follows the OS", () => {
    const fake = fakeEnvironment();
    const store = createThemeStore("ops-theme", fake.environment);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(fake.dataset["theme"]).toBeUndefined();
    expect(store.getResolvedTheme()).toBe("light");
    fake.setSystemDark(true);
    expect(store.getResolvedTheme()).toBe("dark");
    expect(notified).toBe(1);
  });

  test("persists an explicit choice and forgets it on system", () => {
    const fake = fakeEnvironment();
    const store = createThemeStore("ops-theme", fake.environment);
    store.setThemePreference("light");
    expect(fake.stored.get("ops-theme")).toBe("light");
    expect(fake.dataset["theme"]).toBe("light");
    store.setThemePreference("system");
    expect(fake.stored.has("ops-theme")).toBe(false);
    expect(fake.dataset["theme"]).toBeUndefined();
  });

  test("tolerates unavailable storage", () => {
    const fake = fakeEnvironment({ broken: true });
    const store = createThemeStore("ops-theme", fake.environment);
    expect(store.getPreference()).toBe("system");
    store.setThemePreference("dark");
    expect(store.getPreference()).toBe("dark");
    expect(fake.dataset["theme"]).toBe("dark");
  });

  test("follows a change made in another tab, ignoring other keys", () => {
    const fake = fakeEnvironment();
    const store = createThemeStore("ops-theme", fake.environment);
    fake.emitStorage("other", "dark");
    expect(store.getPreference()).toBe("system");
    fake.emitStorage("ops-theme", "dark");
    expect(store.getPreference()).toBe("dark");
    expect(fake.dataset["theme"]).toBe("dark");
  });
});
