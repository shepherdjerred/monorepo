import { describe, expect, it, beforeEach } from "bun:test";
import {
  markEngaged,
  isRecentlyEngaged,
  resetEngagement,
} from "./engagement-tracker.ts";

describe("engagement-tracker", () => {
  beforeEach(() => {
    resetEngagement();
  });

  it("reports an engaged channel as recent within the window", () => {
    markEngaged("chan-1");
    expect(isRecentlyEngaged("chan-1", 60_000)).toBe(true);
  });

  it("reports an untracked channel as not recent", () => {
    expect(isRecentlyEngaged("never-touched", 60_000)).toBe(false);
  });

  it("expires (and evicts) an engagement older than the window", () => {
    markEngaged("chan-2");
    // A negative window guarantees elapsed > window, forcing expiry.
    expect(isRecentlyEngaged("chan-2", -1)).toBe(false);
    // After expiry the entry is evicted, so a generous window is still false.
    expect(isRecentlyEngaged("chan-2", 60_000)).toBe(false);
  });

  it("tracks channels independently", () => {
    markEngaged("a");
    expect(isRecentlyEngaged("a", 60_000)).toBe(true);
    expect(isRecentlyEngaged("b", 60_000)).toBe(false);
  });
});
