import { z } from "zod";
import type {
  ExploreScenarioCase,
  ExploreScenarioSurface,
  ExploreTraceEntry,
} from "@scout-for-lol/data";
import { normalizeEvalText } from "#src/explore/capability-eval.ts";

/**
 * Deterministic checks on one scenario turn.
 *
 * These are the assertions that need no judgement: which tools ran, whether a
 * confirmation card was minted, which phrases appear. They live here, under
 * test, rather than in the script that calls the model — the rule the
 * capability eval learned: an assertion nothing tests is an assertion nobody
 * can trust.
 *
 * Two checks apply to every turn whatever the case says, because they are
 * product rules rather than case facts: Explore never asks for a raw Discord
 * snowflake, and a follow-up chip is never an action the chip cannot perform.
 */

export type ScenarioExpectation = NonNullable<
  ExploreScenarioCase["turns"][number]["expect"]
>;

export type ScenarioTurnEvidence = {
  readonly surface: ExploreScenarioSurface;
  /** Null when the turn failed or timed out before answering. */
  readonly answer: {
    readonly answer: string;
    readonly spokenAnswer?: string | undefined;
    readonly followUps: readonly string[];
  } | null;
  readonly trace: readonly ExploreTraceEntry[];
  /** Whether the turn's fixture image actually reached the agent. */
  readonly imageDelivered: boolean | null;
};

export type ScenarioCheck = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};

const PreparedIntentSchema = z.looseObject({
  kind: z.literal("value"),
  value: z.looseObject({
    kind: z.literal("creation_confirmation_required"),
    intent: z.looseObject({ kind: z.string() }),
  }),
});

/** The creation kinds this turn minted a confirmation card for. */
export function mintedIntentKinds(
  trace: readonly ExploreTraceEntry[],
): readonly string[] {
  return trace.flatMap((entry) => {
    if (entry.status !== "succeeded") return [];
    const parsed = PreparedIntentSchema.safeParse(entry.rawOutput);
    return parsed.success ? [parsed.data.value.intent.kind] : [];
  });
}

/**
 * Asking for a numeric id, in any of the ways the model phrased it in prod.
 *
 * Narrow on purpose: "linked to their Discord account" is fine, and so is
 * naming an id the user already gave. What is never fine is asking a person
 * to go and find a snowflake.
 */
const NUMERIC_ID_REQUEST =
  /\b(?:numeric|numerical|snowflake)\b[^.\n]{1,40}\bids?\b|\bdiscord (?:user )?id\b[^.\n]{1,40}\b(?:send|need|provide|share|enter)\b|\b(?:send|need|provide|share|enter)\b[^.\n]{1,40}\bdiscord (?:user )?id\b/i;

/**
 * A chip that reads as an action rather than a question.
 *
 * A chip only ever sends its text as the next message, so "Confirm the weekly
 * report" does nothing — that is how a prod user clicked Confirm and stayed
 * unconfirmed. Actions live on confirmation cards and buttons.
 */
const ACTION_CHIP =
  /^\s*(?:confirm|accept|approve|click|submit|publish|post|send|enable|activate|delete|disable)\b/i;

function rawTextOf(evidence: ScenarioTurnEvidence): string {
  return evidence.answer === null
    ? ""
    : [evidence.answer.answer, evidence.answer.spokenAnswer ?? ""].join("\n");
}

function toolChecks(
  expect: ScenarioExpectation,
  trace: readonly ExploreTraceEntry[],
): ScenarioCheck[] {
  const tools = new Set(
    trace
      .filter((entry) => entry.status === "succeeded")
      .map((entry) => entry.toolName),
  );
  const ran = [...tools].join(", ") || "nothing";
  const checks: ScenarioCheck[] = expect.toolsCalled.map((group) => {
    const hit = group.find((tool) => tools.has(tool));
    return {
      name: `tool:${group.join("|")}`,
      passed: hit !== undefined,
      detail:
        hit === undefined
          ? `None of ${group.join(", ")} ran. Ran: ${ran}.`
          : `${hit} ran.`,
    };
  });
  for (const tool of expect.toolsNotCalled) {
    checks.push({
      name: `no-tool:${tool}`,
      passed: !tools.has(tool),
      detail: tools.has(tool) ? `${tool} ran.` : `${tool} did not run.`,
    });
  }
  if (expect.intentMinted !== undefined) {
    const minted = mintedIntentKinds(trace);
    checks.push({
      name: `intent:${expect.intentMinted}`,
      passed: minted.includes(expect.intentMinted),
      detail:
        minted.length === 0
          ? "No confirmation card was prepared."
          : `Prepared: ${minted.join(", ")}.`,
    });
  }
  return checks;
}

function phraseChecks(
  expect: ScenarioExpectation,
  evidence: ScenarioTurnEvidence,
): ScenarioCheck[] {
  const answered = evidence.answer !== null;
  const text = normalizeEvalText(rawTextOf(evidence));
  const checks: ScenarioCheck[] = expect.mustMentionAnyOf.map((group) => {
    const hit = group.find((phrase) =>
      text.includes(normalizeEvalText(phrase)),
    );
    return {
      name: `mentions:${group.join("|")}`,
      passed: answered && hit !== undefined,
      detail:
        hit === undefined
          ? `Mentions none of: ${group.join(", ")}.`
          : `Mentions "${hit}".`,
    };
  });
  for (const phrase of expect.mustNotMention) {
    const present = text.includes(normalizeEvalText(phrase));
    checks.push({
      name: `avoids:${phrase}`,
      passed: !present,
      detail: present ? `Says "${phrase}".` : `Does not say "${phrase}".`,
    });
  }
  return checks;
}

/** "You don't need a numeric ID" names one without asking for it. */
const NEGATED =
  /\b(?:do not|don't|does not|doesn't|no need|not need|never|without)\b/i;

/**
 * The first sentence that asks for a numeric id, if any.
 *
 * The negation must sit at the request itself — in the matched phrase or just
 * before it — so "you don't need a username, but send their Discord user ID"
 * still counts. Normalized first: the model writes curly apostrophes.
 */
function idRequest(text: string): string | null {
  return (
    text.split(/(?<=[.!?])\s+|\n+/).find((sentence) => requestsId(sentence)) ??
    null
  );
}

/** Whether any match in the sentence lacks a negation just before it. */
function requestsId(sentence: string): boolean {
  for (let from = 0; from < sentence.length; from += 1) {
    const match = NUMERIC_ID_REQUEST.exec(sentence.slice(from));
    if (match === null) return false;
    const at = from + match.index;
    const before = sentence.slice(Math.max(0, at - 25), at);
    const phrase = sentence.slice(at, at + match[0].length);
    if (!NEGATED.test(normalizeEvalText(`${before}${phrase}`))) return true;
    from = at;
  }
  return false;
}

/** Product rules every turn obeys, whatever its case expects. */
function productRuleChecks(evidence: ScenarioTurnEvidence): ScenarioCheck[] {
  const askedForId = idRequest(rawTextOf(evidence));
  const actionChips = (evidence.answer?.followUps ?? []).filter((chip) =>
    ACTION_CHIP.test(chip),
  );
  return [
    {
      name: "no-numeric-id-request",
      passed: askedForId === null,
      detail:
        askedForId === null
          ? "Did not ask for a numeric id."
          : `Asked for an id: "${askedForId}".`,
    },
    {
      name: "follow-ups-are-questions",
      passed: actionChips.length === 0,
      detail:
        actionChips.length === 0
          ? "No follow-up reads as an action."
          : `Action follow-ups: ${actionChips.map((chip) => JSON.stringify(chip)).join(", ")}.`,
    },
  ];
}

export function scenarioTurnChecks(input: {
  readonly expect: ScenarioExpectation;
  readonly evidence: ScenarioTurnEvidence;
  /** Whether this turn carried a fixture image. */
  readonly hasImage: boolean;
}): readonly ScenarioCheck[] {
  const { expect, evidence } = input;
  const answered = evidence.answer !== null;
  const delivered = evidence.imageDelivered === true;
  return [
    {
      name: "answered",
      passed: answered,
      detail: answered ? "The turn produced an answer." : "No answer.",
    },
    ...toolChecks(expect, evidence.trace),
    ...phraseChecks(expect, evidence),
    ...productRuleChecks(evidence),
    ...(input.hasImage
      ? [
          {
            name: "image-delivered",
            passed: delivered,
            detail: delivered
              ? "The image reached the agent."
              : "This surface cannot attach an image to a turn.",
          },
        ]
      : []),
  ];
}
