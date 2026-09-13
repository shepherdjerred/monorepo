// Antigravity model-id and legacy-name lookups, transcribed from ccusage's
// Rust adapter (`rust/adapters/antigravity/src/parser.rs`). Antigravity's
// protobuf schema sometimes carries only a numeric model id, or a legacy/
// placeholder text name — both need mapping to the real model id used
// elsewhere (e.g. in the shared `@shepherdjerred/llm-models` pricing
// catalog).

export function modelNameFromId(id: number): string {
  switch (id) {
    case 246:
      return "gemini-2.5-pro";
    case 312:
      return "gemini-2.5-flash";
    case 313:
    case 329:
      return "gemini-2.5-flash-thinking";
    case 330:
      return "gemini-2.5-flash-lite";
    case 281:
    case 282:
      return "claude-4-sonnet";
    case 290:
    case 291:
      return "claude-4-opus";
    case 333:
    case 334:
      return "claude-4.5-sonnet";
    case 340:
    case 341:
      return "claude-4.5-haiku";
    case 342:
      return "model_openai_gpt_oss_120b_medium";
    default:
      return id >= 1000
        ? `model_placeholder_m${String(id - 1000)}`
        : `antigravity-model-${String(id)}`;
  }
}

const MODEL_NAME_MAP: Readonly<Record<string, string>> = {
  "gemini 3.7 flash": "gemini-3.7-flash",
  "gemini 3.7 flash thinking": "gemini-3.7-flash",
  "gemini 3.7 pro": "gemini-3.7-pro",
  "gemini 3.7 pro thinking": "gemini-3.7-pro",
  "gemini 3.6 flash": "gemini-3.6-flash",
  "gemini 3 flash": "gemini-3.6-flash",
  "gemini 3.6 pro": "gemini-3.6-pro",
  "gemini 3 pro": "gemini-3-pro",
  "gemini 3 pro thinking": "gemini-3-pro",
  "gemini 2.5 flash": "gemini-2.5-flash",
  "gemini 2.5 pro": "gemini-2.5-pro",
  "gemini 2.0 flash": "gemini-2.0-flash",
  "gemini 2 flash": "gemini-2.0-flash",
  "gemini 2.0 pro": "gemini-2.0-pro",
  "gemini 1.5 flash": "gemini-1.5-flash",
  "gemini 1.5 pro": "gemini-1.5-pro",
  model_placeholder_m26: "claude-opus-4-6",
  model_placeholder_m35: "claude-sonnet-4-6",
  model_placeholder_m36: "gemini-3.1-pro",
  model_placeholder_m37: "gemini-3.1-pro",
  model_placeholder_m16: "gemini-3.1-pro",
  model_placeholder_m18: "gemini-3-flash-preview",
  model_placeholder_m84: "gemini-3-flash-preview",
  model_placeholder_m47: "gemini-3-flash-preview",
  model_placeholder_m132: "gemini-3.5-flash-high",
  model_placeholder_m133: "gemini-3.5-flash-high",
  model_placeholder_m187: "gemini-3.5-flash-extra-low",
  model_placeholder_m20: "gemini-3.5-flash-medium",
  model_openai_gpt_oss_120b_medium: "gpt-oss-120b-medium",
  "gemini-pro-default": "gemini-3.1-pro",
  "gemini-pro-agent": "gemini-3.1-pro",
  "gemini-3-flash-agent": "gemini-3.5-flash-high",
  "gemini-3-flash-agent-a": "gemini-3.5-flash-high",
  "gemini-3-flash-agent-b": "gemini-3.5-flash-high",
  "gemini-3-flash-a": "gemini-3.5-flash-high",
  "gemini-3-flash-b": "gemini-3.5-flash-high",
  "gemini-3-flash-c": "gemini-3-flash-preview",
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-3.5-flash-low": "gemini-3.5-flash-medium",
  "gemini-3.1-pro-high": "gemini-3.1-pro",
  "gemini-3.1-pro-low": "gemini-3.1-pro",
  "gemini-3-pro-high": "gemini-3-pro",
  "gemini-3-pro-low": "gemini-3-pro",
  "claude 3.7 sonnet": "claude-3-7-sonnet",
  "claude 3.7 sonnet thinking": "claude-3-7-sonnet",
  "claude 3.5 sonnet": "claude-3-5-sonnet",
  "claude 3.5 haiku": "claude-3-5-haiku",
  "claude 3 opus": "claude-3-opus",
};

export function normalizeModelName(raw: string): string {
  const cut = raw.trim().toLowerCase();
  const truncated = cut.includes("(")
    ? cut.slice(0, cut.indexOf("(")).trim()
    : cut;
  const mapped = MODEL_NAME_MAP[truncated];
  if (mapped !== undefined) {
    return mapped;
  }
  const dashed = truncated.replaceAll(" ", "-");
  if (
    dashed.startsWith("gemini-") ||
    dashed.startsWith("claude-") ||
    dashed.startsWith("gpt-")
  ) {
    return dashed;
  }
  return raw;
}
