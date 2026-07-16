import { describe, expect, test } from "bun:test";
import { buildSeasonRefreshPrompt } from "./scout-season-refresh-prompt.ts";

describe("buildSeasonRefreshPrompt", () => {
  const baseInput = {
    today: "2026-05-11",
    workdir: "/tmp/scout-season-refresh-abc/monorepo",
    seasonsFile: "packages/scout-for-lol/packages/data/src/seasons.ts",
    seasonsTestFile: "packages/scout-for-lol/packages/data/src/seasons.test.ts",
    changelogFile:
      "packages/scout-for-lol/packages/frontend/src/data/changelog.tsx",
    noDriftSentinel: "NO_DRIFT",
    driftedSentinel: "DRIFTED",
  };

  test("includes the workdir and source-of-truth files", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt).toContain(baseInput.workdir);
    expect(prompt).toContain(baseInput.seasonsFile);
    expect(prompt).toContain(baseInput.seasonsTestFile);
  });

  test("includes today's ISO date so the agent knows the date floor", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt).toContain(baseInput.today);
  });

  test("includes both sentinel strings exactly", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt).toContain(baseInput.noDriftSentinel);
    expect(prompt).toContain(baseInput.driftedSentinel);
  });

  test("forbids renaming existing season IDs", () => {
    // Compatibility-critical: persisted Competition.seasonId rows reference
    // existing IDs by name. The prompt must explicitly forbid renames.
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt).toMatch(/UNTOUCHED|never rename/i);
  });

  test("forbids touching files outside seasons.ts/seasons.test.ts", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain("never modify any file outside");
  });

  test("forbids git/push/PR operations (handled by the calling activity)", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain("never run git commands");
    expect(prompt.toLowerCase()).toContain("never push");
  });

  test("requires verification via bun test", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt).toContain("bun test src/seasons.test.ts");
  });

  test("requires cross-checking at least TWO sources", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt).toMatch(/TWO independent sources|cross.check/i);
  });

  test("instructs a changelog entry only when adding a new season", () => {
    const prompt = buildSeasonRefreshPrompt(baseInput);
    expect(prompt).toContain(baseInput.changelogFile);
    expect(prompt).toContain("buildChangelogEntry({");
    // Gated to brand-new seasons, not date-only corrections.
    expect(prompt).toMatch(/ONLY when you ADD a brand-new season/);
    // Uses today's date in the changelog's space-separated format.
    expect(prompt).toContain('date: "2026 05 11"');
  });
});
