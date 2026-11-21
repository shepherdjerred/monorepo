import { z } from "zod";
import type { DeploymentDetail } from "#shared/contract.ts";
import { evidenceScope } from "#shared/evidence/scope.ts";
import { isOpaqueIdentifier } from "#client/components/identifier.tsx";

export type EvidenceItem = DeploymentDetail["evidence"][number];

/** How one scalar of a receipt is shown. */
export type ReceiptValue =
  | { kind: "text"; text: string }
  /** A long id or digest, shown short with its full value kept. */
  | { kind: "identifier"; value: string }
  | { kind: "time"; value: string }
  | { kind: "link"; url: string };

export type ReceiptFact = { key: string; label: string; value: ReceiptValue };
/** A nested value, kept as formatted JSON behind a disclosure. */
export type ReceiptNested = { key: string; label: string; json: string };

/**
 * An evidence summary or a step message as the page shows it. A producer
 * writes either prose or a JSON object that is its machine receipt; only the
 * latter is a record, and everything else is text shown as written.
 */
export type ParsedSummary =
  | { kind: "text"; text: string }
  | {
      kind: "record";
      /** The receipt's `adapter`, which names what produced it. */
      adapter: string | null;
      facts: ReceiptFact[];
      nested: ReceiptNested[];
    };

const ACRONYMS = new Set(["id", "uid", "url", "uri", "ci", "sha", "oci"]);
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const WEB_URL = /^https?:\/\/\S+$/u;
/** An unbroken token past this length is an id nobody reads to its end. */
const LONG_TOKEN = 32;
/** A flat nested value reads inline up to this many characters. */
const INLINE_LIMIT = 80;

/** A value past this length is a sentence, and reads on a row of its own. */
const WIDE_TEXT = 40;

/** Whether a value needs a whole row rather than one column among the facts. */
export function isWideValue(value: ReceiptValue) {
  return (
    value.kind === "link" ||
    (value.kind === "text" && value.text.length > WIDE_TEXT)
  );
}

/** A receipt key as a label: `planDigest` reads "Plan digest", `sourceBuildId` "Source build ID". */
export function humanizeKey(key: string) {
  const words = key
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .split(/[\s_\-./]+/u)
    .filter((word) => word !== "")
    .map((word) => {
      const lower = word.toLowerCase();
      return ACRONYMS.has(lower) ? lower.toUpperCase() : lower;
    });
  const [first = key, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Scalar = z.infer<typeof ScalarSchema>;
/** A JSON object: what a machine receipt is, and what a record is read from. */
const ObjectSchema = z.record(z.string(), z.unknown());
const FlatListSchema = z.array(ScalarSchema);
const FlatObjectSchema = z.record(z.string(), ScalarSchema);

function scalarText(value: Scalar) {
  if (value === null) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function receiptValue(value: Scalar): ReceiptValue {
  if (typeof value !== "string")
    return { kind: "text", text: scalarText(value) };
  if (TIMESTAMP.test(value)) return { kind: "time", value };
  if (WEB_URL.test(value)) return { kind: "link", url: value };
  const token =
    !/\s/u.test(value) &&
    (isOpaqueIdentifier(value) || value.length > LONG_TOKEN);
  return token ? { kind: "identifier", value } : { kind: "text", text: value };
}

/**
 * A flat nested value as one line: an object of scalars as `key value`
 * pairs, an array of scalars as a list. Null when it is deeper or longer
 * than a line, and so belongs behind the disclosure.
 */
function inlineText(value: unknown) {
  const list = FlatListSchema.safeParse(value);
  const flat = FlatObjectSchema.safeParse(value);
  const text = list.success
    ? list.data.map((entry) => scalarText(entry)).join(", ")
    : flat.success
      ? Object.entries(flat.data)
          .map(([key, entry]) => `${key} ${scalarText(entry)}`)
          .join(" · ")
      : null;
  if (text === null) return null;
  if (text === "") return "none";
  return text.length <= INLINE_LIMIT ? text : null;
}

/** The JSON object a string holds, or null when it holds anything else. */
function jsonObject(text: string) {
  if (!text.trimStart().startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Prose that happens to open with a brace is prose.
    return null;
  }
  const object = ObjectSchema.safeParse(parsed);
  return object.success ? object.data : null;
}

/** Read a summary or a step message: a JSON object is a record, anything else is text. */
export function parseEvidenceSummary(summary: string): ParsedSummary {
  const parsed = jsonObject(summary);
  if (parsed === null) return { kind: "text", text: summary };
  const adapter = parsed["adapter"];
  const facts: ReceiptFact[] = [];
  const nested: ReceiptNested[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "adapter" && typeof value === "string") continue;
    const label = humanizeKey(key);
    const scalar = ScalarSchema.safeParse(value);
    if (scalar.success) {
      facts.push({ key, label, value: receiptValue(scalar.data) });
      continue;
    }
    const inline = inlineText(value);
    if (inline === null)
      nested.push({ key, label, json: JSON.stringify(value, null, 2) });
    else facts.push({ key, label, value: { kind: "text", text: inline } });
  }
  return {
    kind: "record",
    adapter: typeof adapter === "string" ? adapter : null,
    facts,
    nested,
  };
}

export type RecoveryEvidence = {
  recovery: "argo" | "worker" | "content";
  intentId: string;
  items: EvidenceItem[];
};

/** A deployment's evidence under what recorded it. */
export type EvidenceGroups = {
  /** Evidence of each listed step, by stage key. */
  steps: Map<string, EvidenceItem[]>;
  /** Evidence a stage recorded that the deployment lists no step for. */
  unlistedSteps: { key: string; items: EvidenceItem[] }[];
  /** Reported with the deployment's result. */
  finish: EvidenceItem[];
  monitor: EvidenceItem[];
  drift: EvidenceItem[];
  recovery: RecoveryEvidence[];
  /** Ids outside the grammar: older rows and other writers. Still evidence. */
  other: EvidenceItem[];
};

/** Sort a deployment's evidence under its steps and the other writers; nothing is dropped. */
export function groupEvidence(
  deploymentId: string,
  stageKeys: readonly string[],
  evidence: readonly EvidenceItem[],
): EvidenceGroups {
  const groups: EvidenceGroups = {
    steps: new Map(stageKeys.map((key) => [key, []])),
    unlistedSteps: [],
    finish: [],
    monitor: [],
    drift: [],
    recovery: [],
    other: [],
  };
  for (const item of evidence) {
    const scope = evidenceScope(item.id, deploymentId);
    switch (scope.kind) {
      case "stage": {
        const listed = groups.steps.get(scope.key);
        if (listed !== undefined) {
          listed.push(item);
          break;
        }
        const unlisted = groups.unlistedSteps.find(
          (entry) => entry.key === scope.key,
        );
        if (unlisted === undefined)
          groups.unlistedSteps.push({ key: scope.key, items: [item] });
        else unlisted.items.push(item);
        break;
      }
      case "finish": {
        groups.finish.push(item);
        break;
      }
      case "monitor": {
        groups.monitor.push(item);
        break;
      }
      case "drift": {
        groups.drift.push(item);
        break;
      }
      case "recovery": {
        const settled = groups.recovery.find(
          (entry) =>
            entry.recovery === scope.recovery &&
            entry.intentId === scope.intentId,
        );
        if (settled === undefined)
          groups.recovery.push({
            recovery: scope.recovery,
            intentId: scope.intentId,
            items: [item],
          });
        else settled.items.push(item);
        break;
      }
      case "other": {
        groups.other.push(item);
        break;
      }
    }
  }
  return groups;
}

/** How many pieces of evidence no listed step recorded. */
export function deploymentEvidenceCount(groups: EvidenceGroups) {
  return (
    groups.finish.length +
    groups.monitor.length +
    groups.drift.length +
    groups.other.length +
    groups.recovery.reduce((sum, entry) => sum + entry.items.length, 0) +
    groups.unlistedSteps.reduce((sum, entry) => sum + entry.items.length, 0)
  );
}
