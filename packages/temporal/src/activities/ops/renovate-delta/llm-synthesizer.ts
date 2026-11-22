import { generateText } from "ai";
import { isEnabled } from "@shepherdjerred/feature-flags";
import {
  loadFeatureFlagConfiguration,
  type Environment,
} from "@shepherdjerred/feature-flags/config/load.ts";
import { FlagNotFoundError } from "@shepherdjerred/feature-flags/flag-result.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  serializeBodyAttribute,
  withLlmSpan,
} from "@shepherdjerred/llm-observability/span-helpers";
import {
  RenovateImpactLevelSchema,
  RenovateVersionDeltaSchema,
  type RenovateImpactLevel,
  type RenovateVersionDelta,
} from "@shepherdjerred/ops-model/facets.ts";
import { z } from "zod";
import { temporalLlmRuntime } from "#activities/agent/synthesis-runtime.ts";
import { createStructuredLogger } from "#observability/logging.ts";
import type { ChangelogEvidence } from "./changelog-fetcher.ts";
import { approximateVersionsBehind } from "./semver-utils.ts";
import type { ResolvedRenovateCandidate } from "./version-resolver.ts";

export const RENOVATE_LLM_DELTA_FLAG_KEY =
  "temporal-renovate-llm-delta-enabled";
const SYNTHESIS_MODEL = "gpt-6.1-sol";
const SYNTHESIS_MAX_OUTPUT_TOKENS = 600;
const log = createStructuredLogger("ops.renovate-delta.llm");

const LlmDeltaOutputSchema = z.object({
  summary: z.string().min(1).max(600),
  impactLevel: RenovateImpactLevelSchema,
  breakingChanges: z.array(z.string().min(1).max(300)).max(8),
  highlights: z.array(z.string().min(1).max(300)).max(8),
  repoRelevance: z.string().min(1).max(600),
});

type LlmDeltaOutput = z.infer<typeof LlmDeltaOutputSchema>;

export type LlmTextGenerator = (prompt: string) => Promise<string>;

export async function isRenovateLlmDeltaEnabled(
  environment: Environment = Bun.env,
): Promise<boolean> {
  const configuration = loadFeatureFlagConfiguration(environment);
  const workloadEnv = environment["ENVIRONMENT"];
  const fliptEnv =
    configuration.mode === "flipt"
      ? configuration.environment
      : workloadEnv === "prod" || workloadEnv === "production"
        ? "prod"
        : "beta";
  const defaultEnabled = managedBooleanDefault(
    RENOVATE_LLM_DELTA_FLAG_KEY,
    fliptEnv,
  );

  try {
    const result = await isEnabled(RENOVATE_LLM_DELTA_FLAG_KEY, {
      default: defaultEnabled,
      targetingKey: "temporal-renovate-delta-enrichment",
      attributes: {
        environment: fliptEnv,
        namespace: "temporal",
      },
    });
    return result.value;
  } catch (error: unknown) {
    if (error instanceof FlagNotFoundError && configuration.mode !== "flipt") {
      return defaultEnabled;
    }
    throw error;
  }
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return trimmed;
  }
  const firstNewline = trimmed.indexOf("\n");
  return firstNewline === -1
    ? trimmed
    : trimmed.slice(firstNewline + 1, -3).trim();
}

function parseLlmDeltaOutput(rawText: string): LlmDeltaOutput | undefined {
  try {
    const cleaned = stripJsonCodeFence(rawText);
    return LlmDeltaOutputSchema.parse(JSON.parse(cleaned));
  } catch {
    return undefined;
  }
}

function inferDeterministicImpact(
  candidate: ResolvedRenovateCandidate,
  breakingChanges: readonly string[],
): RenovateImpactLevel {
  if (
    candidate.effectiveFromVersion !== null &&
    candidate.effectiveFromVersion === candidate.targetVersion
  ) {
    return "none";
  }
  if (breakingChanges.length > 0) {
    return "breaking";
  }
  switch (candidate.updateType) {
    case "major":
      return "high";
    case "minor":
      return "medium";
    case "patch":
    case "digest":
    case "pin":
    case "unknown":
      return "low";
  }
}

function extractLinesMatching(
  evidenceText: string,
  matcher: (line: string) => boolean,
  limit: number,
): string[] {
  const results: string[] = [];
  for (const rawLine of evidenceText.split(/\r?\n/u)) {
    const cleaned = rawLine
      .replace(/^\s*[-*+]\s+/u, "")
      .replace(/^#{1,6}\s+/u, "")
      .trim();
    if (cleaned.length >= 12 && matcher(cleaned)) {
      results.push(cleaned.slice(0, 240));
      if (results.length >= limit) {
        break;
      }
    }
  }
  return results;
}

export function buildDeterministicDeltaFallback(
  candidate: ResolvedRenovateCandidate,
  evidence: ChangelogEvidence,
): LlmDeltaOutput {
  const breakingChanges = extractLinesMatching(
    evidence.text,
    (line) => /\bbreaking(?:\s+change)?\b|^[a-z]+(?:\([^)]+\))?!:/iu.test(line),
    4,
  );
  const highlights = extractLinesMatching(
    evidence.text,
    (line) =>
      !line.startsWith("### ") &&
      !/^full changelog:/iu.test(line) &&
      !breakingChanges.includes(line),
    4,
  );

  const fromDesc =
    candidate.runningVersion !== null &&
    candidate.pinnedVersion !== null &&
    candidate.runningVersion !== candidate.pinnedVersion
      ? `${candidate.runningVersion} running (${candidate.pinnedVersion} pinned)`
      : (candidate.effectiveFromVersion ?? "untracked baseline");

  const firstHighlight = highlights[0];
  const sourceDesc =
    evidence.evidenceSource === "none"
      ? "No upstream release notes or commit diff were published for this version range."
      : firstHighlight === undefined
        ? `Collected ${evidence.evidenceSource} notes across the version jump.`
        : `Key change: ${firstHighlight}`;

  const summary =
    `Updates ${candidate.packageName} from ${fromDesc} to ${candidate.targetVersion} (${candidate.updateType}). ${sourceDesc}`.slice(
      0,
      580,
    );

  const consumersLabel =
    candidate.consumers.length > 0
      ? candidate.consumers.join(", ")
      : `monorepo (${candidate.ecosystem})`;

  const repoRelevance =
    candidate.runningVersion === null
      ? `Consumed by ${consumersLabel}; updates pinned ${candidate.pinnedVersion ?? "dependency"} to ${candidate.targetVersion}.`
      : `Consumed by ${consumersLabel}; live cluster currently runs ${candidate.runningVersion} toward ${candidate.targetVersion}.`;

  return {
    summary,
    impactLevel: inferDeterministicImpact(candidate, breakingChanges),
    breakingChanges,
    highlights,
    repoRelevance: repoRelevance.slice(0, 580),
  };
}

function buildSynthesisPrompt(
  candidate: ResolvedRenovateCandidate,
  evidence: ChangelogEvidence,
): string {
  const contextPayload = {
    packageName: candidate.packageName,
    ecosystem: candidate.ecosystem,
    updateType: candidate.updateType,
    runningVersion: candidate.runningVersion,
    pinnedVersion: candidate.pinnedVersion,
    effectiveFromVersion: candidate.effectiveFromVersion,
    targetVersion: candidate.targetVersion,
    consumers: candidate.consumers,
    evidenceSource: evidence.evidenceSource,
    evidenceText:
      evidence.text === "" ? "(no upstream release notes)" : evidence.text,
  };

  return [
    "You analyze a pending Renovate dependency update for a production homelab monorepo.",
    "Respond ONLY with a single valid JSON object (no markdown fences, no extra prose) matching this exact schema:",
    '{ "summary": string, "impactLevel": "none" | "low" | "medium" | "high" | "breaking", "breakingChanges": string[], "highlights": string[], "repoRelevance": string }',
    "Requirements:",
    "- summary: 1-2 crisp sentences explaining what changed between runningVersion/pinnedVersion and targetVersion.",
    "- impactLevel: choose 'breaking' only when concrete breaking changes exist; otherwise 'high', 'medium', 'low', or 'none'.",
    "- breakingChanges: concise bullet strings for concrete breaking changes in the version range (empty array if none).",
    "- highlights: up to 5 notable features, fixes, or security changes across the cumulative range.",
    "- repoRelevance: 1 crisp sentence grounded specifically in the listed `consumers` (and live cluster runningVersion when present). Do not speculate beyond the supplied evidence.",
    JSON.stringify(contextPayload),
  ].join("\n");
}

async function defaultGenerateWithRuntime(prompt: string): Promise<string> {
  const llm = temporalLlmRuntime();
  return await withLlmSpan(
    {
      service: "temporal",
      callSite: "renovate_delta_enrichment",
      system: llm.providerFor(SYNTHESIS_MODEL).provider,
    },
    {
      model: SYNTHESIS_MODEL,
      maxTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
      temperature: undefined,
      topP: undefined,
      stopSequences: undefined,
    },
    async (span) => {
      span.setAttribute(
        "gen_ai.input.messages",
        serializeBodyAttribute({ prompt }),
      );
      const result = await generateText({
        model: llm.languageModel(SYNTHESIS_MODEL),
        prompt,
        maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
        maxRetries: 2,
        ...llm.callOptions({ workload: "renovate-delta" }),
      });
      span.setAttribute(
        "gen_ai.output.messages",
        serializeBodyAttribute(result.text),
      );
      return result.text;
    },
  );
}

export async function synthesizeRenovateVersionDelta(input: {
  readonly candidate: ResolvedRenovateCandidate;
  readonly evidence: ChangelogEvidence;
  readonly now?: Date;
  readonly generateLlmText?: LlmTextGenerator;
}): Promise<RenovateVersionDelta> {
  const { candidate, evidence } = input;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const prompt = buildSynthesisPrompt(candidate, evidence);
  const generator = input.generateLlmText ?? defaultGenerateWithRuntime;

  let synthesized: LlmDeltaOutput | undefined;
  if (
    evidence.evidenceSource !== "none" ||
    input.generateLlmText !== undefined
  ) {
    try {
      const rawText = await generator(prompt);
      synthesized = parseLlmDeltaOutput(rawText);
      if (synthesized === undefined) {
        log(
          "warning",
          "Renovate delta LLM output failed schema validation; using deterministic fallback",
          {
            branch: candidate.branch,
            packageName: candidate.packageName,
          },
        );
      }
    } catch (error: unknown) {
      log(
        "warning",
        "Renovate delta LLM synthesis failed; using deterministic fallback",
        {
          branch: candidate.branch,
          packageName: candidate.packageName,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  const finalOutput =
    synthesized ?? buildDeterministicDeltaFallback(candidate, evidence);

  const versionsBehindCount = approximateVersionsBehind(
    candidate.effectiveFromVersion,
    candidate.targetVersion,
    evidence.intermediateReleaseCount,
  );

  return RenovateVersionDeltaSchema.parse({
    cacheKey: candidate.cacheKey,
    generatedAt,
    runningVersion: candidate.runningVersion,
    pinnedVersion: candidate.pinnedVersion,
    targetVersion: candidate.targetVersion,
    effectiveFromVersion: candidate.effectiveFromVersion,
    versionsBehindCount,
    summary: finalOutput.summary,
    impactLevel: finalOutput.impactLevel,
    breakingChanges: finalOutput.breakingChanges,
    highlights: finalOutput.highlights,
    repoRelevance: finalOutput.repoRelevance,
    evidenceSource: evidence.evidenceSource,
    ...(evidence.compareUrl === undefined
      ? {}
      : { compareUrl: evidence.compareUrl }),
    releaseUrls: [...evidence.releaseUrls],
  });
}
