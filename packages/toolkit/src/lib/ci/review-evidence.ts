import {
  ReviewSignalEventSchema,
  type ReviewSignalEvent,
} from "@shepherdjerred/code-review";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";

type ReviewKind = "fresh" | "reused" | "quota-exempt" | "unknown";
type ProviderEvidence = {
  provider: string;
  kind: ReviewKind;
  completionSeconds: number | null;
};
export type ReviewEvidence = {
  kind: ReviewKind | "mixed";
  providers: ProviderEvidence[];
};

function completionSeconds(event: ReviewSignalEvent): number | null {
  return event.decision !== "passed" ||
    !event.reviewed_at_head ||
    event.blocked_reason !== null ||
    event.head_pushed_at === null ||
    event.latency_s === null ||
    event.latency_s < 0 ||
    !Number.isInteger(event.latency_s) ||
    event.completion_signal === "none" ||
    !["reviewed", "reviewed-clean-reaction"].includes(event.review_state)
    ? null
    : Date.parse(event.head_pushed_at) / 1000 + event.latency_s;
}

function providerEvidence(
  provider: string,
  event: ReviewSignalEvent | undefined,
  pipeline: WoodpeckerPipeline,
): ProviderEvidence {
  const unknown: ProviderEvidence = {
    provider,
    kind: "unknown",
    completionSeconds: null,
  };
  if (event?.head_sha !== pipeline.commit) return unknown;
  const observed = Date.parse(event.ts) / 1000;
  const created = pipeline.created ?? 0;
  if (
    created <= 0 ||
    !Number.isFinite(observed) ||
    observed < created ||
    observed > (pipeline.finished ?? 0) + 1
  )
    return unknown;
  if (
    event.review_state === "errored" &&
    event.blocked_reason === "usage-limited"
  )
    return { ...unknown, kind: "quota-exempt" };
  const completion = completionSeconds(event);
  // The producer rounds latency to seconds. Preserve boundary uncertainty.
  if (
    completion === null ||
    !Number.isFinite(completion) ||
    completion > observed + 0.5 ||
    Math.abs(completion - created) <= 0.5
  )
    return unknown;
  return {
    provider,
    kind: completion > created ? "fresh" : "reused",
    completionSeconds: completion,
  };
}

/** One proven provider can pass the OR gate while another is still pending. */
export function reviewEvidence(
  lines: readonly string[],
  pipeline: WoodpeckerPipeline,
): ReviewEvidence {
  let expected: string[] = [];
  const latest = new Map<string, ReviewSignalEvent>();
  for (const line of lines) {
    const header = /^Review gate: providers=([a-z\d,-]+), repo=/.exec(line);
    if (header?.[1] !== undefined) {
      expected = [...new Set(header[1].split(","))];
      latest.clear();
    }
    if (!line.startsWith("{") || !line.includes('"review-signal/v1"')) continue;
    const event = ReviewSignalEventSchema.parse(JSON.parse(line));
    latest.set(event.provider, event);
  }
  const providers = expected.map((provider) =>
    providerEvidence(provider, latest.get(provider), pipeline),
  );
  const kinds = new Set(providers.map((provider) => provider.kind));
  let kind: ReviewEvidence["kind"] = "unknown";
  if (kinds.has("fresh") && kinds.has("reused")) kind = "mixed";
  else if (kinds.has("fresh")) kind = "fresh";
  else if (kinds.has("reused")) kind = "reused";
  else if (kinds.size === 1 && kinds.has("quota-exempt")) kind = "quota-exempt";
  return { kind, providers };
}
