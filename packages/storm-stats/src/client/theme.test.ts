import { describe, expect, test } from "vitest";
import {
  computeToggleOutcome,
  parseStoredScheme,
  resolveActiveScheme,
} from "./theme.ts";

describe("two-state color scheme override logic", () => {
  test("parses only valid light and dark stored overrides", () => {
    expect(parseStoredScheme("light")).toBe("light");
    expect(parseStoredScheme("dark")).toBe("dark");
    expect(parseStoredScheme("system")).toBeNull();
    expect(parseStoredScheme("")).toBeNull();
    expect(parseStoredScheme(null)).toBeNull();
  });

  test("preserves pinned override across OS transitions and clears when toggled back to OS preference", () => {
    // 1. Starting with OS = light and no stored override
    expect(resolveActiveScheme(null, false)).toBe("light");

    // User toggles -> target is dark, differs from OS (light), so store "dark"
    const firstToggle = computeToggleOutcome(null, false);
    expect(firstToggle).toEqual({
      nextStored: "dark",
      metaContent: "dark",
      activeScheme: "dark",
    });

    // 2. OS later switches to dark automatically -> stored "dark" stays active
    expect(resolveActiveScheme(firstToggle.nextStored, true)).toBe("dark");

    // 3. OS switches back to light -> stored "dark" still keeps site dark
    expect(resolveActiveScheme(firstToggle.nextStored, false)).toBe("dark");

    // 4. User toggles again while OS is light -> target is light, matches OS!
    // Stored value is removed (null) and <meta> resets to "light dark"
    const revertToggle = computeToggleOutcome(firstToggle.nextStored, false);
    expect(revertToggle).toEqual({
      nextStored: null,
      metaContent: "light dark",
      activeScheme: "light",
    });
  });

  test("handles toggling from OS dark mode to light override and back", () => {
    const toLight = computeToggleOutcome(null, true);
    expect(toLight).toEqual({
      nextStored: "light",
      metaContent: "light",
      activeScheme: "light",
    });

    const backToSystemDark = computeToggleOutcome(toLight.nextStored, true);
    expect(backToSystemDark).toEqual({
      nextStored: null,
      metaContent: "light dark",
      activeScheme: "dark",
    });
  });
});
