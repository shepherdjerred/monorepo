import { z } from "zod";

export const BENCHMARK_PROVIDER_STARTUP_FAILURE_FILE =
  "provider-startup-failure.json";
export const BENCHMARK_PROVIDER_FAILURE_FILE = "provider-failure.json";

const ProviderFailureKindSchema = z.enum([
  "quota",
  "authentication",
  "provider-startup",
  "provider-turn",
]);
const ProviderFailurePhaseSchema = z.enum(["startup", "turn"]);
const ProviderFailureSourceSchema = z.enum([
  "codex-jsonl",
  "startup-exception",
  "process-exit",
]);

const BenchmarkProviderFailureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: ProviderFailureKindSchema,
  phase: ProviderFailurePhaseSchema,
  source: ProviderFailureSourceSchema,
  message: z.string().min(1),
  eventType: z.string().nullable(),
  codexExitCode: z.number().int().nullable(),
});

export type BenchmarkProviderFailure = z.infer<
  typeof BenchmarkProviderFailureSchema
>;

export const BenchmarkProviderStartupFailureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.literal("startup"),
  message: z.string().min(1),
});

export type BenchmarkProviderStartupFailure = z.infer<
  typeof BenchmarkProviderStartupFailureSchema
>;

type ProviderFailureClassificationInput = {
  jsonl: string;
  codexExitCode: number | null;
  startupError?: string | null;
};

const TraceRecordSchema = z.record(z.string(), z.unknown());
const ErrorRecordSchema = z.looseObject({
  message: z.string().optional(),
});

type FailureEvent = {
  type: string;
  message: string;
};

type ProviderFailureOutput = Omit<BenchmarkProviderFailure, "schemaVersion">;

const QUOTA_PATTERN =
  /\b(?:quota|billing|usage limit|credit balance|rate limit|too many requests|429)\b/i;
const AUTHENTICATION_PATTERN =
  /\b(?:auth(?:entication|orization)?|unauthorized|forbidden|log(?:ged)? in|login|required credentials?|api key|oauth|401|403)\b/i;

export function classifyCodexProviderFailure(
  input: ProviderFailureClassificationInput,
): BenchmarkProviderFailure | null {
  if (input.startupError !== undefined && input.startupError !== null) {
    return providerFailure({
      kind: classifiedKind(input.startupError, "provider-startup"),
      phase: "startup",
      source: "startup-exception",
      message: input.startupError,
      eventType: null,
      codexExitCode: input.codexExitCode,
    });
  }

  let turnStarted = false;
  let failureEvent: FailureEvent | undefined;
  for (const line of input.jsonl.split("\n")) {
    const record = parseRecord(line);
    if (record === undefined) continue;
    const type = record["type"];
    if (type === "turn.started") turnStarted = true;
    if (
      failureEvent === undefined &&
      (type === "error" || type === "turn.failed")
    ) {
      failureEvent = {
        type,
        message: failureMessage(record, type),
      };
    }
  }

  if (failureEvent !== undefined) {
    const phase =
      turnStarted || failureEvent.type === "turn.failed" ? "turn" : "startup";
    const fallbackKind =
      phase === "turn" ? "provider-turn" : "provider-startup";
    return providerFailure({
      kind: classifiedKind(failureEvent.message, fallbackKind),
      phase,
      source: "codex-jsonl",
      message: failureEvent.message,
      eventType: failureEvent.type,
      codexExitCode: input.codexExitCode,
    });
  }

  if (input.codexExitCode !== null && input.codexExitCode !== 0) {
    const phase = turnStarted ? "turn" : "startup";
    return providerFailure({
      kind: phase === "turn" ? "provider-turn" : "provider-startup",
      phase,
      source: "process-exit",
      message: `Codex exited with code ${String(input.codexExitCode)} without a structured provider error`,
      eventType: null,
      codexExitCode: input.codexExitCode,
    });
  }

  return null;
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const record = TraceRecordSchema.safeParse(raw);
  return record.success ? record.data : undefined;
}

function failureMessage(
  record: Record<string, unknown>,
  eventType: string,
): string {
  const direct = record["message"];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  const nested = ErrorRecordSchema.safeParse(record["error"]);
  if (
    nested.success &&
    nested.data.message !== undefined &&
    nested.data.message.trim().length > 0
  ) {
    return nested.data.message.trim();
  }
  return `Codex emitted ${eventType}`;
}

function classifiedKind(
  message: string,
  fallback: "provider-startup" | "provider-turn",
): BenchmarkProviderFailure["kind"] {
  if (QUOTA_PATTERN.test(message)) return "quota";
  if (AUTHENTICATION_PATTERN.test(message)) return "authentication";
  return fallback;
}

function providerFailure(
  input: ProviderFailureOutput,
): BenchmarkProviderFailure {
  return BenchmarkProviderFailureSchema.parse({
    schemaVersion: 1,
    ...input,
  });
}
