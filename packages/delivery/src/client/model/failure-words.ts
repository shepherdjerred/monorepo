import { parseEvidenceSummary } from "#client/evidence.ts";

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
  if (parsed.kind === "text") return parsed.text;
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
    .map((part) => part.trim().replace(/[.;]$/u, ""))
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
