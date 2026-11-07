import { expect, test } from "vitest";
import {
  AGENTS,
  agentArgs,
  capabilities,
  parseAgyModels,
  parseCodexModels,
  parseGrokModels,
  parseKimiModels,
} from "../private_dot_config/herdr-app/mods/my-worktree/agents.js";

test("every Brim provider has a capability entry", () => {
  expect(Object.keys(AGENTS).sort()).toEqual(
    [
      "antigravity",
      "claude-code",
      "codex",
      "cursor",
      "grok",
      "kimi",
      "muse",
    ].sort(),
  );
});

test("defaults add no flags", () => {
  for (const provider of Object.keys(AGENTS))
    expect(
      agentArgs(provider, { mode: null, model: null, effort: null }),
    ).toEqual({ args: [], safe: false });
});

test("choices become each CLI's own flags", () => {
  expect(
    agentArgs("claude-code", { mode: "plan", model: "opus", effort: "high" }),
  ).toEqual({
    args: ["--permission-mode", "plan", "--model", "opus", "--effort", "high"],
    safe: true,
  });
  expect(
    agentArgs("codex", { mode: null, model: "gpt-6-sol", effort: "xhigh" }),
  ).toEqual({
    args: ["-m", "gpt-6-sol", "-c", 'model_reasoning_effort="xhigh"'],
    safe: false,
  });
  expect(
    agentArgs("antigravity", { mode: "plan", model: null, effort: "max" }),
  ).toEqual({ args: ["--mode", "plan", "--effort", "max"], safe: false });
  expect(
    agentArgs("kimi", { mode: "plan", model: null, effort: null }),
  ).toEqual({ args: ["--plan"], safe: false });
  expect(
    agentArgs("grok", { mode: "plan", model: null, effort: null }),
  ).toEqual({ args: ["--permission-mode", "plan"], safe: true });
});

test("a choice the agent doesn't offer is an error", () => {
  expect(() =>
    agentArgs("codex", { mode: "plan", model: null, effort: null }),
  ).toThrow("codex has no mode plan");
  expect(() =>
    agentArgs("kimi", { mode: null, model: null, effort: "high" }),
  ).toThrow("kimi takes no effort");
  expect(capabilities("opencode")).toEqual({
    modes: [],
    efforts: [],
    model: null,
    effort: null,
  });
});

test("Codex models come listed, ordered, with their reasoning levels", () => {
  const cache = JSON.stringify({
    models: [
      { slug: "b", display_name: "B", visibility: "list", priority: 2 },
      { slug: "hidden", visibility: "hide", priority: 0 },
      {
        slug: "a",
        display_name: "A",
        visibility: "list",
        priority: 1,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "max" }],
      },
    ],
  });
  expect(parseCodexModels(cache)).toEqual([
    { id: "a", label: "A", efforts: ["low", "max"] },
    { id: "b", label: "B", efforts: undefined },
  ]);
  expect(() => parseCodexModels("{}")).toThrow("No models");
});

test("agy, grok and kimi catalogs parse from their own output", () => {
  expect(
    parseAgyModels(
      "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6\n",
    ),
  ).toEqual([
    { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  ]);
  expect(
    parseGrokModels(
      "You are logged in.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.6\n",
    ).map((m) => m.id),
  ).toEqual(["grok-4.7", "grok-4.6"]);
  expect(
    parseKimiModels(
      'default_model = "kimi-code/k3.1-pro"\n[models."kimi-code/k3"]\nx = 1\n[models."kimi-code/k3.1-pro"]\n',
    ),
  ).toEqual([
    { id: "kimi-code/k3", label: "k3" },
    { id: "kimi-code/k3.1-pro", label: "k3.1-pro" },
  ]);
});
