// What the new-worktree dialog can choose for each agent: a mode, a model and
// an effort, and the CLI flags each choice becomes. Pure: no Herdr or GPUI
// imports, so the dotfiles test suite can load it.
//
// `null` everywhere means the agent's own default (its config). Plan-style
// modes run with AGENT_SAFE=1 so the agent-bin wrapper adds no bypass flag
// that would contradict them.

const EFFORTS_5 = ["low", "medium", "high", "xhigh", "max"];

/** provider -> { modes, efforts, modelFlag, effortFlag(e) }. */
export const AGENTS = {
  "claude-code": {
    modes: [
      {
        id: "plan",
        label: "Plan",
        args: ["--permission-mode", "plan"],
        safe: true,
      },
      {
        id: "auto",
        label: "Auto",
        args: ["--permission-mode", "auto"],
        safe: true,
      },
    ],
    efforts: EFFORTS_5,
    model: (m) => ["--model", m],
    effort: (e) => ["--effort", e],
  },
  codex: {
    modes: [],
    // Per-model levels come from the catalog; these are the fallback.
    efforts: ["low", "medium", "high", "xhigh", "max"],
    model: (m) => ["-m", m],
    effort: (e) => ["-c", `model_reasoning_effort="${e}"`],
  },
  antigravity: {
    modes: [
      { id: "plan", label: "Plan", args: ["--mode", "plan"] },
      {
        id: "accept-edits",
        label: "Accept edits",
        args: ["--mode", "accept-edits"],
      },
      { id: "auto", label: "Auto", args: ["--mode", "auto"] },
    ],
    efforts: EFFORTS_5,
    model: (m) => ["--model", m],
    effort: (e) => ["--effort", e],
  },
  cursor: {
    modes: [
      { id: "plan", label: "Plan", args: ["--mode", "plan"] },
      { id: "ask", label: "Ask", args: ["--mode", "ask"] },
    ],
    efforts: [],
    model: (m) => ["--model", m],
    effort: null,
  },
  grok: {
    modes: [
      {
        id: "plan",
        label: "Plan",
        args: ["--permission-mode", "plan"],
        safe: true,
      },
    ],
    efforts: ["low", "medium", "high", "xhigh"],
    model: (m) => ["-m", m],
    effort: (e) => ["--effort", e],
  },
  kimi: {
    modes: [{ id: "plan", label: "Plan", args: ["--plan"] }],
    efforts: [],
    model: (m) => ["-m", m],
    effort: null,
  },
  muse: {
    modes: [],
    efforts: [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ],
    model: (m) => ["--model", m],
    effort: (e) => ["--effort", e],
  },
};

/** What a provider offers; a provider missing here offers nothing. */
export function capabilities(provider) {
  return (
    AGENTS[provider] ?? { modes: [], efforts: [], model: null, effort: null }
  );
}

/**
 * The agent flags for a choice `{ mode, model, effort }` (each an id or null),
 * and whether the wrapper's bypass flags must be skipped (`safe`).
 * An id the provider doesn't offer is an error: the dialog only offers valid ones.
 */
export function agentArgs(provider, choice) {
  const caps = capabilities(provider);
  const args = [];
  let safe = false;
  if (choice.mode) {
    const mode = caps.modes.find((m) => m.id === choice.mode);
    if (!mode) throw new Error(`${provider} has no mode ${choice.mode}.`);
    args.push(...mode.args);
    safe = Boolean(mode.safe);
  }
  if (choice.model) {
    if (!caps.model) throw new Error(`${provider} takes no model.`);
    args.push(...caps.model(choice.model));
  }
  if (choice.effort) {
    if (!caps.effort) throw new Error(`${provider} takes no effort.`);
    args.push(...caps.effort(choice.effort));
  }
  return { args, safe };
}

// Model catalogs, from each CLI's own list. Each parser returns
// [{ id, label, efforts? }], best first, and throws on output it can't read.

/** ~/.codex/models_cache.json: listed models, with their reasoning levels. */
export function parseCodexModels(text) {
  const models = JSON.parse(text)?.models;
  if (!Array.isArray(models)) throw new Error("No models in the Codex cache.");
  return models
    .filter((m) => m?.visibility === "list" && typeof m.slug === "string")
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((m) => ({
      id: m.slug,
      label: m.display_name || m.slug,
      efforts: Array.isArray(m.supported_reasoning_levels)
        ? m.supported_reasoning_levels.map((l) => l.effort).filter(Boolean)
        : undefined,
    }));
}

/** `agy models`: "id<TAB>Label" lines after a progress line. */
export function parseAgyModels(text) {
  return text
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [id, label] = line.split("\t");
      return { id: id.trim(), label: (label ?? id).trim() };
    })
    .filter((m) => m.id);
}

/** `grok models`: "  * id (default)" and "  - id" lines. */
export function parseGrokModels(text) {
  return text
    .split("\n")
    .map((line) => /^\s*[*-]\s+(\S+)/.exec(line)?.[1])
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
}

/** ~/.kimi-code/config.toml: its [models."id"] tables. */
export function parseKimiModels(text) {
  return [...text.matchAll(/^\[models\."([^"]+)"\]\s*$/gm)].map((m) => ({
    id: m[1],
    label: m[1].replace(/^kimi-code\//, ""),
  }));
}

/** Claude Code takes aliases for the latest of each family. */
export const CLAUDE_MODELS = ["fable", "opus", "sonnet", "haiku"].map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
}));
