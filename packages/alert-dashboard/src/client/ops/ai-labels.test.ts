import { describe, expect, it } from "vitest";

import {
  providerLabel,
  quotaMeterName,
  windowLabel,
  windowLabelParts,
} from "./ai-labels.ts";

describe("providerLabel", () => {
  it.each([
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["antigravity", "Antigravity"],
    ["cursor", "Cursor"],
    ["grok", "Grok"],
    ["kimi", "Kimi"],
    ["muse", "Muse"],
  ])("names the known provider %s", (provider, label) => {
    expect(providerLabel(provider)).toBe(label);
  });

  it.each([
    ["claude", "Claude"],
    ["some_new-tool", "Some New Tool"],
    ["openRouter", "Open Router"],
  ])("title-cases the unknown provider %s", (provider, label) => {
    expect(providerLabel(provider)).toBe(label);
  });

  it("keeps an id it cannot split into words", () => {
    expect(providerLabel("--")).toBe("--");
  });
});

describe("windowLabel", () => {
  it.each([
    // provider, window id, window kind, label
    ["antigravity", "antigravity-gemini-5h", "modelScoped", "Gemini · 5h"],
    [
      "antigravity",
      "antigravity-gemini-weekly",
      "modelScoped",
      "Gemini · Weekly",
    ],
    ["antigravity", "antigravity-3p-5h", "modelScoped", "Third-party · 5h"],
    ["antigravity", "weekly", "weekly", "Weekly"],
    ["claude-code", "five-hour", "rolling", "5-hour"],
    ["claude-code", "weekly", "weekly", "Weekly"],
    ["claude-code", "weekly-opus", "modelScoped", "Weekly · Opus"],
    ["codex", "codex-primary-window", "rolling", "Primary window"],
    ["codex", "codex-secondary-window", "weekly", "Secondary window · Weekly"],
    ["cursor", "monthly", "monthly", "Monthly"],
    ["cursor", "cursor-other-models", "providerDefined", "Other models"],
    ["grok", "grok-extra-credits", "credits", "Extra credits"],
    ["kimi", "kimi-5-hour", "rolling", "5-hour"],
    ["kimi", "kimi-monthly-code", "modelScoped", "Monthly · Code"],
    ["kimi", "shared", "providerDefined", "Shared"],
    ["claude", "7d", "weekly", "7d · Weekly"],
    ["claude", "5h", "session", "5h · Session"],
  ])("labels %s %s (%s) as %s", (provider, windowId, windowKind, label) => {
    expect(windowLabel({ provider, windowId, windowKind })).toBe(label);
  });

  it("names a window by its kind when its id says nothing", () => {
    expect(
      windowLabel({
        provider: "muse",
        windowId: "muse-window",
        windowKind: "rolling",
      }),
    ).toBe("Rolling window");
    expect(
      windowLabel({
        provider: "grok",
        windowId: "grok",
        windowKind: "monthly",
      }),
    ).toBe("Monthly");
  });

  it("ignores a kind that is only the id repeated", () => {
    // The collector sends the id as the kind when Brim reported none.
    expect(
      windowLabel({
        provider: "codex",
        windowId: "codex-primary-window",
        windowKind: "codex-primary-window",
      }),
    ).toBe("Primary window");
    expect(
      windowLabel({ provider: "muse", windowId: "muse", windowKind: "muse" }),
    ).toBe("muse");
  });

  it("keeps an unknown kind visible beside the id", () => {
    expect(
      windowLabelParts({
        provider: "kimi",
        windowId: "kimi-subscription",
        windowKind: "entitlement",
      }),
    ).toEqual(["Subscription", "Entitlement"]);
  });

  it("only drops the provider when the id starts with it", () => {
    expect(
      windowLabel({
        provider: "codex",
        windowId: "weekly-codex",
        windowKind: "weekly",
      }),
    ).toBe("Weekly · Codex");
  });
});

describe("quotaMeterName", () => {
  it("names a meter by provider and window without the separator", () => {
    expect(
      quotaMeterName({
        provider: "antigravity",
        windowId: "antigravity-gemini-5h",
        windowKind: "modelScoped",
      }),
    ).toBe("Antigravity Gemini 5h quota used");
    expect(
      quotaMeterName({
        provider: "claude",
        windowId: "7d",
        windowKind: "weekly",
      }),
    ).toBe("Claude 7d Weekly quota used");
  });
});
