import {
  woodpeckerJson,
  pipelineUrl,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";
import { isFailure } from "./status.ts";
import { sanitizeText } from "./redaction.ts";
import { decodeLogs } from "./native-logs.ts";
export type Diagnostic = {
  workflow: string;
  step: string | null;
  stepId: number | null;
  exitCode: number | null;
  error: string | null;
  logs: string;
  truncated: boolean;
  url: string;
  command: string;
};

export function logExcerpt(
  raw: unknown,
  secrets: readonly string[],
  maxCharacters = 4000,
): { logs: string; truncated: boolean } {
  const decoded = decodeLogs(raw).join("\n");
  const safe = sanitizeText(decoded, secrets);
  const lines = safe.split(/\r?\n/);
  const tail = lines.slice(-60).join("\n");
  return {
    logs: tail.slice(-maxCharacters),
    truncated: lines.length > 60 || tail.length > maxCharacters,
  };
}

type Workflow = WoodpeckerPipeline["workflows"][number];
type DiagnosticContext = {
  pipeline: WoodpeckerPipeline;
  config: WoodpeckerConfig;
  secrets: readonly string[];
  signal: AbortSignal | undefined;
};

function diagnosticStep(workflow: Workflow) {
  const children = workflow.children ?? [];
  return (
    children.find(
      (child) => child.name === workflow.name && isFailure(child.state),
    ) ??
    children.find((child) => isFailure(child.state) && child.type !== "service")
  );
}

async function diagnosticFor(
  workflow: Workflow,
  context: DiagnosticContext,
): Promise<Diagnostic> {
  const { pipeline, config, signal, secrets } = context;
  const step = diagnosticStep(workflow);
  const url = `${pipelineUrl(pipeline, config)}${workflow.pid === undefined ? "" : `/${String(workflow.pid)}`}`;
  let error = workflow.error ?? step?.error ?? null;
  let excerpt = { logs: "", truncated: false };
  if (step !== undefined) {
    try {
      const raw = await woodpeckerJson(
        `/api/repos/${String(config.repoId)}/logs/${String(pipeline.number)}/${String(step.id)}`,
        config,
        signal,
      );
      excerpt = logExcerpt(raw, [config.token, ...secrets]);
    } catch (error_) {
      if (signal?.aborted === true) throw error_;
      const message = error_ instanceof Error ? error_.message : String(error_);
      error = `${error === null ? "" : `${error}; `}Logs unavailable: ${message}`;
    }
  }
  return {
    workflow: workflow.name,
    step: step?.name ?? null,
    stepId: step?.id ?? null,
    exitCode: step?.exit_code ?? null,
    error:
      error === null ? null : sanitizeText(error, [config.token, ...secrets]),
    ...excerpt,
    url,
    command:
      step === undefined
        ? `toolkit woodpecker pipeline show shepherdjerred/monorepo ${String(pipeline.number)}`
        : `toolkit woodpecker pipeline log show shepherdjerred/monorepo ${String(pipeline.number)} ${String(step.pid)}`,
  };
}

export async function pipelineDiagnostics(
  pipeline: WoodpeckerPipeline | null,
  config: WoodpeckerConfig,
  secrets: readonly string[] = [],
  signal?: AbortSignal,
): Promise<Diagnostic[]> {
  if (pipeline === null) return [];
  const failed = pipeline.workflows
    .filter((workflow) => isFailure(workflow.state))
    .toSorted(
      (a, b) =>
        Number(a.name === "ci-complete") - Number(b.name === "ci-complete") ||
        (a.finished ?? 0) - (b.finished ?? 0),
    );
  const diagnostics: Diagnostic[] = [];
  for (const workflow of failed.slice(0, 3))
    diagnostics.push(
      await diagnosticFor(workflow, { pipeline, config, secrets, signal }),
    );
  return diagnostics;
}
