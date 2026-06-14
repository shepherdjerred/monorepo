import { describe, test, expect } from "bun:test";
import { downgrade, canDowngrade, getModeLabel } from "#lib/session/mode.ts";

describe("session mode", () => {
  test("downgrade from full goes to text_ai", () => {
    const result = downgrade("full", "voice disconnected");
    expect(result.mode).toBe("text_ai");
    expect(result.message).toContain("voice disconnected");
  });

  test("downgrade from text_ai goes to minimal_ai", () => {
    const result = downgrade("text_ai", "API rate limited");
    expect(result.mode).toBe("minimal_ai");
    expect(result.message).toContain("API rate limited");
  });

  test("downgrade from minimal_ai goes to offline", () => {
    const result = downgrade("minimal_ai", "no connection");
    expect(result.mode).toBe("offline");
  });

  test("downgrade from offline stays offline", () => {
    const result = downgrade("offline", "already offline");
    expect(result.mode).toBe("offline");
    expect(result.message).toContain("Already in offline mode");
  });

  test("canDowngrade returns true for valid downgrades", () => {
    expect(canDowngrade("full", "text_ai")).toBe(true);
    expect(canDowngrade("full", "offline")).toBe(true);
    expect(canDowngrade("text_ai", "minimal_ai")).toBe(true);
  });

  test("canDowngrade returns false for same or upgrades", () => {
    expect(canDowngrade("offline", "full")).toBe(false);
    expect(canDowngrade("text_ai", "full")).toBe(false);
    expect(canDowngrade("offline", "offline")).toBe(false);
  });

  test("getModeLabel returns human-readable labels", () => {
    expect(getModeLabel("full")).toBe("Full (voice + AI)");
    expect(getModeLabel("text_ai")).toBe("Text AI");
    expect(getModeLabel("minimal_ai")).toBe("Minimal AI (timer + tests only)");
    expect(getModeLabel("offline")).toBe("Offline (timer only)");
  });
});
