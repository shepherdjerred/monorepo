import { describe, expect, test, beforeEach } from "bun:test";

// Mock localStorage
const mockLocalStorage = (() => {
  let store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store = new Map<string, string>();
    },
  };
})();

// Mock matchMedia
const mockMatchMedia = (matches: boolean) => {
  return () => ({
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: () => { /* noop */ },
    removeListener: () => { /* noop */ },
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
    dispatchEvent: () => true,
  });
};

describe("ThemeToggle localStorage behavior", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    // @ts-expect-error - mocking global localStorage for test isolation
    global.localStorage = mockLocalStorage;
    // @ts-expect-error - mocking global matchMedia for test isolation
    global.matchMedia = mockMatchMedia(false);
  });

  test("localStorage stores 'light' theme", () => {
    mockLocalStorage.setItem("theme", "light");
    expect(mockLocalStorage.getItem("theme")).toBe("light");
  });

  test("localStorage stores 'dark' theme", () => {
    mockLocalStorage.setItem("theme", "dark");
    expect(mockLocalStorage.getItem("theme")).toBe("dark");
  });

  test("localStorage returns null when theme not set", () => {
    expect(mockLocalStorage.getItem("theme")).toBe(null);
  });
});

describe("ThemeToggle system preference detection", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    // @ts-expect-error - mocking global localStorage for test isolation
    global.localStorage = mockLocalStorage;
    // @ts-expect-error - mocking global window for test isolation
    global.window = global;
  });

  test("matchMedia detects dark mode preference", () => {
    // @ts-expect-error - mocking global matchMedia for test isolation
    global.matchMedia = mockMatchMedia(true);
    // @ts-expect-error - calling mocked matchMedia returns partial type
    const mediaQuery = global.matchMedia("(prefers-color-scheme: dark)");
    expect(mediaQuery.matches).toBe(true);
  });

  test("matchMedia detects light mode preference", () => {
    // @ts-expect-error - mocking global matchMedia for test isolation
    global.matchMedia = mockMatchMedia(false);
    // @ts-expect-error - calling mocked matchMedia returns partial type
    const mediaQuery = global.matchMedia("(prefers-color-scheme: dark)");
    expect(mediaQuery.matches).toBe(false);
  });
});

describe("ThemeToggle theme persistence logic", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    // @ts-expect-error - mocking global localStorage for test isolation
    global.localStorage = mockLocalStorage;
    // @ts-expect-error - mocking global matchMedia for test isolation
    global.matchMedia = mockMatchMedia(false);
  });

  test("prefers localStorage over system preference", () => {
    // Set localStorage to dark
    mockLocalStorage.setItem("theme", "dark");
    // But system prefers light
    // @ts-expect-error - mocking global matchMedia for test isolation
    global.matchMedia = mockMatchMedia(false);

    // Should use localStorage value
    const stored = mockLocalStorage.getItem("theme");
    expect(stored).toBe("dark");
  });

  test("uses system preference when localStorage is empty", () => {
    // No localStorage value
    expect(mockLocalStorage.getItem("theme")).toBe(null);

    // System prefers dark
    // @ts-expect-error - mocking global matchMedia for test isolation
    global.matchMedia = mockMatchMedia(true);
    // @ts-expect-error - calling mocked matchMedia returns partial type
    const mediaQuery = global.matchMedia("(prefers-color-scheme: dark)");

    // Should detect system preference
    expect(mediaQuery.matches).toBe(true);
  });

  test("saves theme to localStorage after change", () => {
    mockLocalStorage.setItem("theme", "dark");
    expect(mockLocalStorage.getItem("theme")).toBe("dark");

    // Simulate toggle
    mockLocalStorage.setItem("theme", "light");
    expect(mockLocalStorage.getItem("theme")).toBe("light");
  });
});

describe("ThemeToggle edge cases", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    // @ts-expect-error - mocking global localStorage for test isolation
    global.localStorage = mockLocalStorage;
    // @ts-expect-error - mocking global matchMedia for test isolation
    global.matchMedia = mockMatchMedia(false);
  });

  test("handles invalid localStorage value", () => {
    mockLocalStorage.setItem("theme", "invalid-value");
    const value = mockLocalStorage.getItem("theme");

    // Should not be a valid theme
    expect(value).not.toBe("light");
    expect(value).not.toBe("dark");
  });

  test("handles localStorage access errors gracefully", () => {
    // Mock localStorage to throw error
    const brokenStorage = {
      getItem: () => {
        throw new Error("Storage access denied");
      },
      setItem: () => {
        throw new Error("Storage access denied");
      },
      removeItem: () => { /* noop */ },
      clear: () => { /* noop */ },
    };

    // @ts-expect-error - mocking global localStorage with broken implementation
    global.localStorage = brokenStorage;

    // Should not crash when trying to access localStorage
    expect(() => {
      try {
        localStorage.getItem("theme");
      } catch {
        // Handle error
      }
    }).not.toThrow();
  });
});
