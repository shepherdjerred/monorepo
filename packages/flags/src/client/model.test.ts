import { expect, test } from "vitest";
import { z } from "zod";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import generatedSchemas from "@shepherdjerred/feature-flags/flag-value-schemas.generated.json";
import catalogJson from "@shepherdjerred/llm-models/catalog.json";
import {
  addSegment,
  applyJsonText,
  defaultEditMode,
  deploymentPath,
  filterFlags,
  flagPath,
  flagState,
  issuePathLabel,
  issuesForKey,
  jsonSchemaFor,
  jsonText,
  pageTitle,
  reviewText,
  searchSuffix,
  draftError,
  listState,
  sameFlag,
  sidebarEntries,
  valueIssues,
  valueKind,
  withQuery,
} from "./model.ts";
import {
  modelChoices,
  modelValueNotice,
  type ModelChoice,
  type ValueChoices,
} from "./value-choices.ts";

test("builds deployment and flag paths with encoded segments", () => {
  expect(deploymentPath("scout", "prod")).toBe("/scout/prod");
  expect(flagPath("scout", "prod", "dares_enabled")).toBe(
    "/scout/prod/dares_enabled",
  );
  expect(flagPath("scout", "prod", "a/b")).toBe("/scout/prod/a%2Fb");
});

test("the tab title names the flag and deployment, most specific first", () => {
  expect(pageTitle(undefined)).toBe("Flags");
  expect(pageTitle({ catalog: "scout", stage: "prod" })).toBe(
    "scout/prod · Flags",
  );
  expect(pageTitle({ catalog: "scout", stage: "prod", key: "dares" })).toBe(
    "dares · scout/prod · Flags",
  );
});

test("prod-only catalogs are one row and two-stage catalogs stay grouped", () => {
  expect(
    sidebarEntries([
      "tracker/prod",
      "scout/prod",
      "scout/beta",
      "minecraft/tsmc",
    ]),
  ).toEqual([
    { kind: "single", id: "minecraft/tsmc", label: "minecraft/tsmc" },
    {
      kind: "group",
      catalog: "scout",
      stages: [
        { id: "scout/beta", label: "Beta" },
        { id: "scout/prod", label: "Prod" },
      ],
    },
    { kind: "single", id: "tracker/prod", label: "tracker" },
  ]);
});

test("lists boolean presence and the variant string", () => {
  expect(
    listState({ type: "boolean", key: "a", default: true, rollouts: [] }),
  ).toBe("On");
  expect(
    listState({ type: "boolean", key: "a", default: false, rollouts: [] }),
  ).toBe("Off");
  expect(
    listState({
      type: "boolean",
      key: "a",
      default: false,
      rollouts: [
        { constraints: [{ property: "stage", value: "beta" }], result: true },
      ],
    }),
  ).toBe("Targeted");
  expect(
    listState({ type: "variant", key: "model", value: "gpt-6-luna" }),
  ).toBe("gpt-6-luna");
});

test("rejects a segment that cannot match", () => {
  const blank = addSegment({
    type: "boolean",
    key: "a",
    default: false,
    rollouts: [],
  });
  expect(draftError(blank)).toBe("Segment 1 has an empty constraint");
  expect(
    draftError({ type: "variant", key: "model", value: "" }),
  ).toBeUndefined();
  expect(
    sameFlag(
      { type: "boolean", key: "a", default: true, rollouts: [] },
      { type: "boolean", key: "a", default: false, rollouts: [] },
    ),
  ).toBe(false);
});

test("search filters flags by key, ignoring case and surrounding spaces", () => {
  const flags = [
    { key: "Dares_Enabled" },
    { key: "debug" },
    { key: "llm-daily-token-budget" },
  ];
  expect(filterFlags(flags, "")).toEqual(flags);
  expect(filterFlags(flags, "  ")).toEqual(flags);
  expect(filterFlags(flags, "DARES")).toEqual([{ key: "Dares_Enabled" }]);
  expect(filterFlags(flags, " d ")).toEqual(flags);
  expect(filterFlags(flags, "token")).toEqual([
    { key: "llm-daily-token-budget" },
  ]);
  expect(filterFlags(flags, "zzz")).toEqual([]);
});

test("the search round-trips through the page URL", () => {
  expect(searchSuffix("")).toBe("");
  expect(searchSuffix(" a b ")).toBe("?q=a%20b");
  // The field's own params keep the text as typed and drop an empty search.
  const page = new URLSearchParams("q=old&tab=x");
  expect(withQuery(page, "a ").get("q")).toBe("a ");
  expect(withQuery(page, "a ").get("tab")).toBe("x");
  expect(withQuery(page, "").has("q")).toBe(false);
  expect(page.get("q")).toBe("old");
});

test("flag state splits into a glyph kind and the word shown", () => {
  expect(
    flagState({ type: "boolean", key: "a", default: true, rollouts: [] }),
  ).toEqual({ kind: "on", label: "On" });
  expect(
    flagState({ type: "boolean", key: "a", default: false, rollouts: [] }),
  ).toEqual({ kind: "off", label: "Off" });
  expect(flagState({ type: "variant", key: "v", value: "" })).toEqual({
    kind: "variant",
    label: "(empty)",
  });
});

const environments: FlagValue = {
  type: "variant",
  key: "delivery-enabled-environments",
  value: '["beta","prod"]',
};
const concurrency: FlagValue = {
  type: "variant",
  key: "delivery-executor-concurrency",
  value: "8",
};
const season: FlagValue = {
  type: "variant",
  key: "storm-forum-season",
  value: "winter",
};
const unmanaged: FlagValue = { type: "variant", key: "legacy", value: "x" };
const toggle: FlagValue = {
  type: "boolean",
  key: "dares_enabled",
  default: false,
  rollouts: [],
};

test("the registry decides each flag's value kind and its default mode", () => {
  expect(valueKind(environments)).toEqual({
    kind: "managed",
    key: "delivery-enabled-environments",
    encoding: "json",
  });
  expect(valueKind(concurrency)).toMatchObject({ encoding: "number" });
  expect(valueKind(season)).toMatchObject({ encoding: "string" });
  expect(valueKind(unmanaged)).toEqual({ kind: "unmanaged" });
  expect(valueKind(toggle)).toEqual({ kind: "boolean" });

  expect(defaultEditMode(environments)).toBe("json");
  for (const flag of [concurrency, season, unmanaged, toggle])
    expect(defaultEditMode(flag)).toBe("form");
});

test("JSON mode shows decoded values, literals, or the whole boolean flag", () => {
  expect(jsonText(environments)).toBe('[\n  "beta",\n  "prod"\n]');
  expect(jsonText(concurrency)).toBe("8");
  expect(jsonText(season)).toBe('"winter"');
  expect(jsonText(unmanaged)).toBe('"x"');
  expect(JSON.parse(jsonText(toggle))).toEqual(toggle);
  // A stored JSON value that does not parse is shown as typed, to be fixed.
  expect(jsonText({ ...environments, value: "[oops" })).toBe("[oops");

  expect(reviewText(environments)).toBe('[\n  "beta",\n  "prod"\n]');
  expect(JSON.parse(reviewText(concurrency))).toEqual(concurrency);
});

test("JSON text reads back into the draft, encoded canonically", () => {
  expect(applyJsonText(environments, '[ "beta" ,\n "staging" ]')).toEqual({
    ok: true,
    flag: { ...environments, value: '["beta","staging"]' },
  });
  // Valid object values are stored with their defaults filled in.
  const mail: FlagValue = {
    type: "variant",
    key: "mail-settings",
    value: "{}",
  };
  expect(applyJsonText(mail, '{ "retentionDays": 7 }')).toEqual({
    ok: true,
    flag: {
      ...mail,
      value:
        '{"retentionDays":7,"maxPerClientPerTenMinutes":200,"allowCleartextSmtpAuth":false}',
    },
  });
  // An invalid but well-typed value becomes the draft; the registry reports it.
  const invalid = applyJsonText(environments, '[""]');
  expect(invalid).toEqual({
    ok: true,
    flag: { ...environments, value: '[""]' },
  });
  if (!invalid.ok) throw new Error("unreachable");
  expect(valueIssues(invalid.flag).map((issue) => issue.path)).toEqual(["/0"]);

  expect(applyJsonText(concurrency, "1e1")).toEqual({
    ok: true,
    flag: { ...concurrency, value: "10" },
  });
  expect(applyJsonText(concurrency, '"10"')).toEqual({
    ok: false,
    issues: [{ path: "", message: "Expected a JSON number" }],
  });
  expect(applyJsonText(season, "3")).toEqual({
    ok: false,
    issues: [{ path: "", message: "Expected a JSON string" }],
  });
  const broken = applyJsonText(season, '"winter');
  expect(broken.ok).toBe(false);
  expect(broken.ok ? [] : broken.issues[0]?.message).toMatch(
    /^Invalid JSON: /u,
  );
});

test("boolean JSON keeps its key and type and refuses empty constraints", () => {
  const on = { ...toggle, default: true };
  expect(applyJsonText(toggle, JSON.stringify(on))).toEqual({
    ok: true,
    flag: on,
  });
  const renamed = applyJsonText(toggle, JSON.stringify({ ...on, key: "x" }));
  expect(renamed.ok ? [] : renamed.issues.map((issue) => issue.path)).toEqual([
    "/key",
  ]);
  const blank = applyJsonText(
    toggle,
    JSON.stringify({
      ...on,
      rollouts: [{ constraints: [{ property: "", value: "1" }], result: true }],
    }),
  );
  expect(blank.ok ? [] : blank.issues.map((issue) => issue.path)).toEqual([
    "/rollouts/0/constraints/0/property",
  ]);
});

test("JSON Schemas come from the flag schema and the generated registry", () => {
  expect(jsonSchemaFor(toggle)).toMatchObject({
    type: "object",
    properties: {
      type: { const: "boolean" },
      key: { const: "dares_enabled" },
      default: { type: "boolean" },
    },
    required: ["type", "key", "default", "rollouts"],
    additionalProperties: false,
  });
  // One schema object per key, so the editor does not re-register it.
  expect(jsonSchemaFor(toggle)).toBe(jsonSchemaFor({ ...toggle }));
  expect(jsonSchemaFor(environments)).toEqual(
    generatedSchemas["delivery-enabled-environments"].schema,
  );
  expect(jsonSchemaFor(unmanaged)).toEqual({ type: "string" });
});

// ---- Choices: closed enum/const lists and catalog models ----

function variant(key: string, value = ""): FlagValue {
  return { type: "variant", key, value };
}

function choicesOf(key: string): ValueChoices | undefined {
  const kind = valueKind(variant(key));
  if (kind.kind !== "managed") throw new Error(`${key} is not managed`);
  return kind.choices;
}

function modelValues(key: string): readonly ModelChoice[] {
  const choices = choicesOf(key);
  if (choices === undefined || choices.closed)
    throw new Error(`${key} has no model choices`);
  return choices.values;
}

const CatalogSliceSchema = z.record(
  z.string(),
  z.object({
    id: z.string(),
    status: z.string(),
    pricingOnly: z.boolean().optional(),
    capabilities: z.object({ inputModalities: z.array(z.string()) }),
    routes: z.object({
      native: z.object({ provider: z.string() }).optional(),
      codexSdk: z.unknown().optional(),
      claudeAgentSdk: z.unknown().optional(),
    }),
  }),
);
const catalog = new Map(
  Object.values(CatalogSliceSchema.parse(catalogJson)).map((entry) => [
    entry.id,
    entry,
  ]),
);

test("enum and const keys get a closed list in schema order", () => {
  expect(choicesOf("storm-forum-season")).toMatchObject({ closed: true });
  expect(choicesOf("storm-forum-season")?.values[0]).toEqual({
    value: "auto",
    label: "auto",
  });
  expect(
    choicesOf("storm-forum-season")?.values.map((choice) => choice.value),
  ).toEqual([
    "auto",
    "normal",
    "spring",
    "summer",
    "autumn",
    "winter",
    "newyear",
    "valentines",
    "easter",
    "midsummer",
    "harvest",
    "halloween",
    "thanksgiving",
    "christmas",
  ]);
  expect(choicesOf("birmel-llm-reasoning-effort")?.values).toEqual(
    ["minimal", "low", "medium", "high"].map((value) => ({
      value,
      label: value,
    })),
  );
  expect(choicesOf("storm-brain-conversation-model")).toEqual({
    closed: true,
    values: [{ value: "gpt-6-luna", label: "gpt-6-luna" }],
  });
});

test("free-form and JSON keys have no choices", () => {
  for (const key of [
    "delivery-enabled-environments",
    "delivery-executor-concurrency",
    "alert-dashboard-email-to",
  ])
    expect(choicesOf(key)).toBeUndefined();
  expect(valueKind(environments)).not.toHaveProperty("choices");
});

test("model keys list routable catalog models, current first, then by name", () => {
  const values = modelValues("birmel-llm-model");
  const order = { current: 0, preview: 1, deprecated: 2 };
  for (const [index, choice] of values.entries()) {
    const previous = values[index - 1];
    if (previous === undefined) continue;
    const byStatus = order[previous.status] - order[choice.status];
    expect(byStatus).toBeLessThanOrEqual(0);
    if (byStatus === 0)
      expect(previous.label.localeCompare(choice.label)).toBeLessThan(0);
  }
  expect(values.at(-1)?.status).toBe("deprecated");
  expect(values[0]).toMatchObject({ status: "current" });
  expect(values.find((choice) => choice.value === "gpt-6.1-sol")).toEqual({
    value: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    status: "current",
    detail: expect.any(String),
  });
});

function ids(key: string): string[] {
  return modelValues(key).map((choice) => choice.value);
}

test("model choices exclude pricing-only entries and follow the key's route", () => {
  const pricingOnly = [...catalog.values()]
    .filter((entry) => entry.pricingOnly === true)
    .map((entry) => entry.id);
  expect(pricingOnly.length).toBeGreaterThan(0);
  for (const key of [
    "birmel-llm-model",
    "scout-explore-model",
    "temporal-agent-chat-imessage-codex-model",
    "temporal-agent-chat-imessage-claude-model",
  ])
    for (const id of pricingOnly) expect(ids(key)).not.toContain(id);

  expect(ids("birmel-llm-embedding-model")).toEqual(["text-embedding-3-small"]);
  expect(ids("birmel-llm-decisions-model")).toEqual(["gpt-6-luna"]);
  expect(ids("storm-brain-decisions-model")).toEqual(["gpt-6-luna"]);
  // Current before preview, whatever the names.
  expect(ids("birmel-llm-image-model")).toEqual([
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
  ]);
  expect(ids("birmel-llm-model")).not.toContain("text-embedding-3-small");
  expect(ids("birmel-llm-model")).toContain("claude-opus-5");

  for (const id of ids("temporal-agent-chat-imessage-codex-model"))
    expect(catalog.get(id)?.routes.codexSdk).toBeDefined();
  for (const id of ids("temporal-agent-chat-discord-claude-default-model"))
    expect(catalog.get(id)?.routes.claudeAgentSdk).toBeDefined();
  expect(ids("temporal-agent-chat-imessage-codex-model")).not.toContain(
    "claude-opus-5",
  );
  expect(ids("temporal-agent-chat-imessage-claude-model")).not.toContain(
    "gpt-6.1-sol",
  );
  for (const id of ids("scout-explore-model"))
    expect(catalog.get(id)?.capabilities.inputModalities).toContain("image");
});

test("a capability requirement drops catalog models without it", () => {
  const language = modelChoices({ kind: "native", endpoint: "language" });
  const withImages = modelChoices({
    kind: "native",
    endpoint: "language",
    requires: ["imageInput"],
  });
  expect(withImages).toEqual(
    language.filter((choice) =>
      catalog.get(choice.value)?.capabilities.inputModalities.includes("image"),
    ),
  );
});

test("JSON mode offers catalog models as examples on one stable schema", () => {
  const flag = variant("storm-brain-model", "gpt-6.1-sol");
  const schema = jsonSchemaFor(flag);
  expect(schema).toMatchObject({
    type: "string",
    "x-model-route": { kind: "native", endpoint: "language" },
    examples: modelValues("storm-brain-model").map((choice) => choice.value),
  });
  expect(jsonSchemaFor({ ...flag })).toBe(schema);
  expect(jsonSchemaFor(season)).not.toHaveProperty("examples");
});

test("model values outside the catalog, its route, or its current set get a notice", () => {
  const choices = choicesOf("storm-brain-model");
  if (choices === undefined) throw new Error("storm-brain-model has choices");
  expect(modelValueNotice(choices, "gpt-6.1-sol")).toBeUndefined();
  expect(modelValueNotice(choices, "")).toBeUndefined();
  expect(modelValueNotice(choices, "gpt-7-imaginary")).toBe(
    "Not in the shared model catalog — consumers reject unknown models (storm-brain fails at startup). Add it to @shepherdjerred/llm-models first.",
  );
  expect(modelValueNotice(choices, "kimi-k3.1-pro")).toContain(
    "pricing-only in the catalog",
  );
  expect(modelValueNotice(choices, "text-embedding-3-small")).toContain(
    "has no native language route with structured outputs in the catalog",
  );
  expect(modelValueNotice(choices, "gpt-5.5")).toMatch(
    /^Deprecated in the catalog/u,
  );
  const claude = choicesOf("temporal-agent-chat-imessage-claude-model");
  if (claude === undefined) throw new Error("claude model has choices");
  expect(modelValueNotice(claude, "claude-imaginary")).toContain(
    "Claude Agent SDK unchecked",
  );
  expect(modelValueNotice(claude, "gpt-6.1-sol")).toContain(
    "has no Claude Agent SDK route",
  );
  const closed = choicesOf("storm-forum-season");
  if (closed === undefined) throw new Error("season has choices");
  expect(modelValueNotice(closed, "anything")).toBeUndefined();
});

test("server issues are kept for the edited key and labelled by path", () => {
  expect(
    issuesForKey(
      [
        { key: "a", path: "/0", message: "bad" },
        { key: "b", path: "", message: "other" },
      ],
      "a",
    ),
  ).toEqual([{ path: "/0", message: "bad" }]);
  expect(issuePathLabel("")).toBe("value");
  expect(issuePathLabel("/rollouts/0")).toBe("/rollouts/0");
});
