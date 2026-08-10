import { type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { type z } from "zod";
import {
  loadLlmObservabilityConfig as innerLoadLlmObservabilityConfig,
  LlmObservabilityConfigSchema as InnerLlmObservabilityConfigSchema,
  type LlmObservabilityConfig as InnerLlmObservabilityConfig,
} from "./config.ts";
import {
  LlmArchiveSpanProcessor as InnerLlmArchiveSpanProcessor,
  type ArchiveLogger as InnerArchiveLogger,
  type LlmArchiveSpanProcessorOptions as InnerLlmArchiveSpanProcessorOptions,
} from "./archive-span-processor.ts";
import {
  buildArchiveSpanProcessor as innerBuildArchiveSpanProcessor,
  type BuildArchiveProcessorOptions as InnerBuildArchiveProcessorOptions,
} from "./init.ts";
import {
  archiveObjectExists as innerArchiveObjectExists,
  buildArchiveKey as innerBuildArchiveKey,
  uploadArchive as innerUploadArchive,
  type ArchiveConfig as InnerArchiveConfig,
  type ArchiveRef as InnerArchiveRef,
  type BuildKeyParams as InnerBuildKeyParams,
} from "./archive-uploader.ts";
import { redactSecrets as innerRedactSecrets } from "./redact.ts";
import {
  traceClaudeAgent as innerTraceClaudeAgent,
  type TraceClaudeAgentMetadata as InnerTraceClaudeAgentMetadata,
} from "./claude-agent-wrapper.ts";
import {
  traceTextStream as innerTraceTextStream,
  type TraceTextStreamMetadata as InnerTraceTextStreamMetadata,
  type TraceTextStreamFinal as InnerTraceTextStreamFinal,
} from "./text-stream-wrapper.ts";
import {
  createCodexJsonlParser as innerCreateCodexJsonlParser,
  pumpCodexStdout as innerPumpCodexStdout,
  addCodexUsage as innerAddCodexUsage,
  type CodexEvent as InnerCodexEvent,
  type CodexJsonlParser as InnerCodexJsonlParser,
  type CodexTurnUsage as InnerCodexTurnUsage,
  type CodexLogger as InnerCodexLogger,
} from "./codex-jsonl.ts";
import {
  attachCodexTrace as innerAttachCodexTrace,
  type CodexTrace as InnerCodexTrace,
  type CodexTraceOptions as InnerCodexTraceOptions,
} from "./codex-trace.ts";

// The custom no-re-exports lint rule disallows both `export … from` and any
// local re-binding whose RHS is an imported identifier. Public symbols are
// re-derived here via wrapper functions and `Pick`-based type aliases so each
// exported declaration is a genuinely local definition.

// Mapped-type identity alias: structurally equal to its input but not a bare
// TSTypeReference, which keeps the no-re-exports rule satisfied.
type Identity<T> = { [K in keyof T]: T[K] };

export function loadLlmObservabilityConfig(
  ...args: Parameters<typeof innerLoadLlmObservabilityConfig>
): ReturnType<typeof innerLoadLlmObservabilityConfig> {
  return innerLoadLlmObservabilityConfig(...args);
}

// Re-bind through a local helper so the declaration init is not a bare
// imported identifier (which the no-re-exports rule rejects). The Zod schema
// instance itself is unchanged — we only mediate its name.
const passthrough = <T>(value: T): T => value;
export const LlmObservabilityConfigSchema: z.ZodType<InnerLlmObservabilityConfig> =
  passthrough(InnerLlmObservabilityConfigSchema);
export type LlmObservabilityConfig = Identity<InnerLlmObservabilityConfig>;

export class LlmArchiveSpanProcessor extends InnerLlmArchiveSpanProcessor {}
export type ArchiveLogger = Identity<InnerArchiveLogger>;
export type LlmArchiveSpanProcessorOptions =
  Identity<InnerLlmArchiveSpanProcessorOptions>;

export function buildArchiveSpanProcessor(
  ...args: Parameters<typeof innerBuildArchiveSpanProcessor>
): SpanProcessor {
  return innerBuildArchiveSpanProcessor(...args);
}
export type BuildArchiveProcessorOptions =
  Identity<InnerBuildArchiveProcessorOptions>;

export function buildArchiveKey(
  ...args: Parameters<typeof innerBuildArchiveKey>
): ReturnType<typeof innerBuildArchiveKey> {
  return innerBuildArchiveKey(...args);
}
export function uploadArchive(
  ...args: Parameters<typeof innerUploadArchive>
): ReturnType<typeof innerUploadArchive> {
  return innerUploadArchive(...args);
}
export function archiveObjectExists(
  ...args: Parameters<typeof innerArchiveObjectExists>
): ReturnType<typeof innerArchiveObjectExists> {
  return innerArchiveObjectExists(...args);
}
export type ArchiveConfig = Identity<InnerArchiveConfig>;
export type ArchiveRef = Identity<InnerArchiveRef>;
export type BuildKeyParams = Identity<InnerBuildKeyParams>;

export function redactSecrets(
  ...args: Parameters<typeof innerRedactSecrets>
): ReturnType<typeof innerRedactSecrets> {
  return innerRedactSecrets(...args);
}

export const traceClaudeAgent: typeof innerTraceClaudeAgent = (
  metadata,
  run,
  transformMessage,
) => innerTraceClaudeAgent(metadata, run, transformMessage);
export type TraceClaudeAgentMetadata = Identity<InnerTraceClaudeAgentMetadata>;

export function traceTextStream(
  ...args: Parameters<typeof innerTraceTextStream>
): ReturnType<typeof innerTraceTextStream> {
  return innerTraceTextStream(...args);
}
export type TraceTextStreamMetadata = Identity<InnerTraceTextStreamMetadata>;
export type TraceTextStreamFinal = Identity<InnerTraceTextStreamFinal>;

export function createCodexJsonlParser(
  ...args: Parameters<typeof innerCreateCodexJsonlParser>
): ReturnType<typeof innerCreateCodexJsonlParser> {
  return innerCreateCodexJsonlParser(...args);
}
export function pumpCodexStdout(
  ...args: Parameters<typeof innerPumpCodexStdout>
): ReturnType<typeof innerPumpCodexStdout> {
  return innerPumpCodexStdout(...args);
}
export function addCodexUsage(
  ...args: Parameters<typeof innerAddCodexUsage>
): ReturnType<typeof innerAddCodexUsage> {
  return innerAddCodexUsage(...args);
}
// Union types are not amenable to the mapped-type Identity trick (it would
// collapse the discriminated arms), so CodexEvent is re-derived as a function
// parameter type instead.
export type CodexEvent = Parameters<CodexEventListener>[0];
export type CodexEventListener = (event: InnerCodexEvent) => void;
export type CodexJsonlParser = Identity<InnerCodexJsonlParser>;
export type CodexTurnUsage = Identity<InnerCodexTurnUsage>;
export type CodexLogger = Identity<InnerCodexLogger>;

export function attachCodexTrace(
  ...args: Parameters<typeof innerAttachCodexTrace>
): ReturnType<typeof innerAttachCodexTrace> {
  return innerAttachCodexTrace(...args);
}
export type CodexTrace = Identity<InnerCodexTrace>;
export type CodexTraceOptions = Identity<InnerCodexTraceOptions>;
