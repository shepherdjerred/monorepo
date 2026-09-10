import type { TurnAnswer } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

const TOOL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROVIDER_FUNCTION_CITATION =
  /^functions\.([a-z0-9]+(?:-[a-z0-9]+)*)(?::\d+)?$/;

export type CitationToolEvent = {
  toolCallId: string;
  toolId: string;
  success: boolean;
};

export type GroundedToolEvent = CitationToolEvent & {
  readOnly: boolean;
  inputKey: string;
};

function successfulToolEvents(
  toolEvents: readonly CitationToolEvent[],
): CitationToolEvent[] {
  return toolEvents.filter((event) => event.success);
}

function citationToolAlias(citation: string): string | null {
  const prefixed = PROVIDER_FUNCTION_CITATION.exec(citation);
  if (prefixed?.[1] !== undefined) {
    return prefixed[1];
  }
  if (citation.length > 0 && citation.length <= 64 && TOOL_ID.test(citation)) {
    return citation;
  }
  return null;
}

/**
 * Models often copy OpenRouter/OpenAI function names (`functions.external-service:0`)
 * instead of the SDK `toolCallId`. Map that alias only when exactly one
 * successful call of that tool exists this turn. Anything else is left
 * unchanged for retry or `requireGroundedAnswer`.
 */
export function resolveCitationIds(
  citations: readonly string[],
  toolEvents: readonly CitationToolEvent[],
): string[] {
  const succeeded = successfulToolEvents(toolEvents);
  const byCallId = new Set(succeeded.map((event) => event.toolCallId));
  return citations.map((citation) => {
    if (byCallId.has(citation)) {
      return citation;
    }
    const alias = citationToolAlias(citation);
    if (alias === null) {
      return citation;
    }
    const matches = succeeded.filter((event) => event.toolId === alias);
    if (matches.length !== 1) {
      return citation;
    }
    const match = matches[0];
    if (match === undefined) {
      return citation;
    }
    return match.toolCallId;
  });
}

export function withResolvedCitations(
  answer: TurnAnswer,
  toolEvents: readonly CitationToolEvent[],
): TurnAnswer {
  return {
    ...answer,
    reliedOnToolCallIds: resolveCitationIds(
      answer.reliedOnToolCallIds,
      toolEvents,
    ),
  };
}

/**
 * A supported answer that cites nothing, or cites IDs that did not succeed,
 * after a real success is malformed structured output, not evidence we may
 * invent. Retry it with the successful IDs in the prompt;
 * `requireGroundedAnswer` still rejects invented IDs.
 */
export function needsCitationRetry(
  answer: TurnAnswer,
  toolEvents: readonly CitationToolEvent[],
): boolean {
  if (answer.disposition !== "supported") {
    return false;
  }
  if (!toolEvents.some((event) => event.success)) {
    return false;
  }
  const succeeded = new Set(
    successfulToolEvents(toolEvents).map((event) => event.toolCallId),
  );
  if (answer.reliedOnToolCallIds.length === 0) {
    return true;
  }
  return answer.reliedOnToolCallIds.some(
    (toolCallId) => !succeeded.has(toolCallId),
  );
}

export function citationRetryPrompt(
  answer: TurnAnswer,
  toolEvents: readonly CitationToolEvent[],
): string {
  const listed = successfulToolEvents(toolEvents)
    .map((event) => `${event.toolCallId} (${event.toolId})`)
    .join("\n");
  const succeeded = new Set(
    successfulToolEvents(toolEvents).map((event) => event.toolCallId),
  );
  const invalid = answer.reliedOnToolCallIds.filter(
    (toolCallId) => !succeeded.has(toolCallId),
  );
  const invalidLine =
    invalid.length === 0
      ? "Cited IDs: none."
      : `Cited IDs that are not successful tool call IDs: ${invalid.join(", ")}.`;
  return `Your previous structured answer claimed supported work but did not cite successful tool call IDs from this turn.
${invalidLine}

Previous answer JSON:
${JSON.stringify(answer)}

Successful tool calls this turn (cite only IDs from this list that the answer actually used):
${listed}

Return a complete TurnAnswer with disposition "supported" and performedMutation ${String(answer.performedMutation)} that cites the successful tool call IDs from this list that your answer relied on. Do not invent IDs. Do not cite functions.<tool-name> or functions.<tool-name>:0; those are provider function names, not toolCallId values. Preserve the original answer text, disposition, and mutation claim; repair only the reliedOnToolCallIds citations.`;
}

/**
 * Repairs citations from a retried answer while preserving the original
 * turn's text, disposition, and mutation claim. Rejects any attempt to alter
 * disposition or performedMutation.
 */
/**
 * The anti-hallucination gate.
 *
 * The old runtime named one tool before the turn began and threw unless that
 * exact tool succeeded. That fixed the plan before any evidence existed, so an
 * ordinary "this actually needs a different tool" became a hard failure.
 *
 * This checks the same property from the other end: whatever the reply says it
 * relied on must correspond to a tool call that really succeeded this turn. It
 * covers every claim rather than one pre-named tool, and it lets the agent
 * change its mind freely along the way.
 */
export function requireGroundedAnswer(
  answer: TurnAnswer,
  toolEvents: readonly GroundedToolEvent[],
): void {
  const succeeded = new Set(
    toolEvents
      .filter(({ success }) => success)
      .map(({ toolCallId }) => toolCallId),
  );
  const ungrounded = answer.reliedOnToolCallIds.filter(
    (toolCallId) => !succeeded.has(toolCallId),
  );
  if (ungrounded.length > 0) {
    throw new Error(
      `Answer cited tool calls that did not succeed this turn: ${ungrounded.join(", ")}`,
    );
  }
  // Runs regardless of disposition, not only "supported": disposition is
  // itself model-generated, so a failed mutation mislabeled "conversation" or
  // "unsupported" - with nothing cited - would otherwise skip straight past
  // every other check here. Membership in the success set is not enough
  // either: a harmless lookup can succeed while the requested mutation never
  // runs, or the model can point at an unrelated success - a harmless read,
  // or a different attempt of the same tool - while the operation that
  // actually mattered failed and was never fixed. Checking only what
  // happened after a citation is not enough: the failure can come first and
  // the unrelated success get cited afterward, which reads as "grounded"
  // under a citation-relative check but is exactly the same lie. So this
  // ignores citation order and citation entirely: any write, destructive, or
  // code-execution call that fails, with no LATER call succeeding anywhere in
  // the turn, leaves that attempt uncorrected regardless of what the answer
  // claims or cites. A failed read is exempt - re-checking something
  // incidental and having that check fail says nothing about whether the
  // claimed outcome holds. That exemption is per-call, not per-tool: a
  // composite tool like manage-role exposes read actions (list, get)
  // alongside destructive ones (create, delete) under one tool-level risk
  // class, so a failed list must not be treated as an uncorrected write just
  // because the tool it belongs to can also destroy things.
  //
  // "Later call" means the same tool AND the same input: matching on the
  // action field alone is not enough, because a composite tool's action still
  // covers many different targets - a failed manage-role create for one role
  // is not corrected by a later create for a different one. Requiring the
  // full input to match is the only generic, per-tool-agnostic way to tell
  // "this exact operation was retried" from "a similarly-shaped one ran."
  // The cost is real: a retry that adjusts its input to fix what the first
  // attempt got wrong no longer counts as correcting it, so that turn is
  // rejected rather than credited. That is the intended trade - an honest
  // failure over a claim this check cannot actually verify - not an
  // oversight; loosening it is what created every earlier version of this
  // gap.
  const uncorrectedFailure = toolEvents.find(
    (event, index) =>
      !event.success &&
      !event.readOnly &&
      !toolEvents
        .slice(index + 1)
        .some(
          (later) =>
            later.success &&
            later.toolId === event.toolId &&
            later.inputKey === event.inputKey,
        ),
  );
  if (uncorrectedFailure !== undefined) {
    throw new Error(
      `Turn reported completion, but ${uncorrectedFailure.toolId} failed and was never retried successfully this turn`,
    );
  }
  // Checking the global success set is not enough: a harmless lookup can
  // succeed while the requested mutation never runs, and an answer citing
  // nothing would still pass. Only "supported" work must cite at least one
  // call - conversation and unsupported outcomes are allowed to cite
  // nothing, and every cited call is already known to have succeeded by the
  // check above.
  if (answer.disposition !== "supported") {
    return;
  }
  if (answer.reliedOnToolCallIds.length === 0) {
    throw new Error(
      "Answer claims supported work without citing a successful tool call",
    );
  }
  // Citing a successful call proves only that SOME call succeeded, not that
  // it is the one the answer's claim actually describes: a model could cite
  // a harmless, unrelated read while claiming an unrelated mutation
  // happened, and every check above would still pass. performedMutation is a
  // second, independent self-report that must agree with the citations - a
  // true mutation claim has to be backed by an actually non-read cited call.
  // A model dishonest enough to misreport performedMutation itself is not
  // caught by this, but that is a narrower, less likely failure than citing
  // any convenient success: it requires contradicting the answer's own text.
  if (
    answer.performedMutation &&
    !toolEvents.some(
      (event) =>
        event.success &&
        !event.readOnly &&
        answer.reliedOnToolCallIds.includes(event.toolCallId),
    )
  ) {
    throw new Error(
      "Answer claims a mutation happened, but cites no successful non-read tool call",
    );
  }
}

export function applyCitationRepair(
  original: TurnAnswer,
  retried: TurnAnswer,
): TurnAnswer {
  if (retried.disposition !== "supported") {
    throw new Error(
      "Citation retry must remain supported and cite valid tool calls",
    );
  }
  if (retried.performedMutation !== original.performedMutation) {
    throw new Error("Citation retry cannot alter the turn's mutation claim");
  }
  return {
    ...original,
    reliedOnToolCallIds: retried.reliedOnToolCallIds,
  };
}
