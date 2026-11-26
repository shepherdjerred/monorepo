import { expect, test } from "vitest";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import generatedSchemas from "@shepherdjerred/feature-flags/flag-value-schemas.generated.json";
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
