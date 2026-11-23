import { parseEvidenceSummary } from "#client/evidence.ts";
import { hasTrace, plainCause } from "#shared/evidence/plain-cause.ts";

/**
 * The recorded texts, each once, that carry source excerpts or stack frames:
 * as recorded, for a disclosure, while the prose says only their sentence.
 */
export function tracesOf(texts: readonly (string | null | undefined)[]) {
  return [
    ...new Set(
      texts.flatMap((text) => (text != null && hasTrace(text) ? [text] : [])),
    ),
  ];
}

/** The receipt keys whose text states why the work was refused or failed. */
const REASON_KEYS = new Set([
  "reason",
  "refusal",
  "refused",
  "error",
  "cause",
  "failure",
  "message",
  "detail",
]);

/**
 * A step message or a piece of evidence in words: its text, the reason its
 * receipt records for a refusal or failure, or what kind of receipt it is.
 */
export function spoken(summary: string, kind?: string) {
  const parsed = parseEvidenceSummary(summary);
  if (parsed.kind === "text") {
    // A runtime's source excerpt and stack frames are not words for a reader.
    const words = plainCause(parsed.text);
    return words === "" ? null : words;
  }
  const reason = parsed.facts.find(
    (fact) => REASON_KEYS.has(fact.key) && fact.value.kind === "text",
  )?.value;
  if (reason?.kind === "text" && reason.text !== "") return reason.text;
  if (kind === undefined) return null;
  return parsed.adapter === null
    ? `a ${kind} receipt`
    : `a ${kind} receipt from ${parsed.adapter}`;
}

/**
 * A clause that tells the reader what to do, such as "inspect its recorded
 * UID and bounded stage logs". Executors end a cause with one, and several
 * records of one failure repeat the same one.
 */
const REMEDY = /^(?:inspect|check|retry|fix|re-?run|request|look at|wait) /iu;

/** The clauses of a recorded sentence: split at `;` and at sentence ends. */
function clauses(text: string) {
  return text
    .split(/(?<=[.;])\s+/u)
    .map((part) => part.trim().replace(/[.;]+$/u, ""))
    .filter((part) => part !== "");
}

function sentence(text: string) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * Says each clause once across the records of one failure: the deployment's
 * message, its step's message and its last evidence. `say` returns a
 * record's causes not said before, or null when it adds none, and collects
 * its remedies apart, so each instruction appears once under "What you can
 * do".
 */
export function sayOnce() {
  const said = new Set<string>();
  const remedies: string[] = [];
  return {
    say(text: string | null) {
      if (text === null) return null;
      const causes: string[] = [];
      for (const clause of clauses(text)) {
        const key = clause.toLowerCase();
        if (said.has(key)) continue;
        said.add(key);
        if (REMEDY.test(clause)) remedies.push(sentence(clause));
        else causes.push(clause);
      }
      return causes.length === 0 ? null : causes.join("; ");
    },
    remedies,
  };
}

const JOB = /\bJob (?<job>[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*)/u;
const UID =
  /\bUID (?<uid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/iu;

/**
 * The Kubernetes Job and UID a failure's records name, so "inspect its
 * recorded UID" points at one. Newest evidence first; each value once.
 */
export function failurePointers(detail: {
  evidence: readonly { summary: string }[];
  stages: readonly { message: string }[];
}) {
  const texts = [
    ...detail.evidence.toReversed().map((item) => item.summary),
    ...detail.stages.map((stage) => stage.message),
  ];
  const pointers: { label: "Job" | "UID"; value: string }[] = [];
  for (const [label, pattern, group] of [
    ["Job", JOB, "job"],
    ["UID", UID, "uid"],
  ] as const) {
    const value = texts
      .map((text) => pattern.exec(text)?.groups?.[group])
      .find((found) => found !== undefined);
    if (value !== undefined) pointers.push({ label, value });
  }
  return pointers;
}
