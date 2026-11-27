import { Client, Connection, type ConnectionOptions } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { z } from "zod";

export const TemporalReplayNamespaceSchema = z.enum(["dev", "beta", "prod"]);

export type TemporalReplayTarget =
  string | { readonly workflowId: string; readonly runId: string };

/** Keep distinct executions of a continued Workflow; never collapse by ID. */
export function parseTemporalReplayTargets(
  args: readonly string[],
  validateWorkflowId: (value: string) => string,
): TemporalReplayTarget[] {
  const targets: TemporalReplayTarget[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === undefined) throw new Error("Missing replay target");
    if (value !== "--run") {
      targets.push(validateWorkflowId(value));
      continue;
    }
    const workflowId = args[++index];
    const runId = args[++index];
    if (workflowId === undefined || runId === undefined)
      throw new Error("--run requires a Workflow ID and run UUID");
    targets.push({
      workflowId: validateWorkflowId(workflowId),
      runId: z.uuid().parse(runId),
    });
  }
  return targets;
}

export function temporalOperatorConnectionOptions(
  environment: Readonly<Record<string, string | undefined>>,
): ConnectionOptions {
  const address = environment["TEMPORAL_ADDRESS"];
  if (address === undefined || address.length === 0) {
    throw new Error("TEMPORAL_ADDRESS is required for live history replay");
  }
  const tls = z
    .enum(["true", "false"])
    .optional()
    .parse(environment["TEMPORAL_TLS"]);
  const apiKey = environment["TEMPORAL_API_KEY"];
  if (apiKey !== undefined && (tls !== "true" || apiKey.length === 0)) {
    throw new Error("A nonempty TEMPORAL_API_KEY requires TEMPORAL_TLS=true");
  }
  return {
    address,
    ...(tls === "true" ? { tls: true } : {}),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

/** History fetches overlap; replay itself stays one sequential worker. */
const HISTORY_FETCH_CONCURRENCY = 8;

export type TemporalReplayHistory = {
  readonly workflowId: string;
  readonly runId: string | undefined;
  readonly history: unknown;
};

export type TemporalReplayOutcome = {
  readonly workflowId: string;
  readonly runId: string;
  readonly error?: Error | undefined;
};

/** The shape of Worker.runReplayHistories: one replay worker, one bundle. */
export type TemporalReplayBatch = (
  options: { workflowsPath: string },
  histories: Iterable<{ workflowId: string; history: unknown }>,
) => AsyncIterable<TemporalReplayOutcome>;

/** Run `map` over `items` at most `limit` at a time; results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Concurrency limit must be a positive integer");
  const results: R[] = [];
  let next = 0;
  async function lane(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      const item = items[index];
      if (item === undefined) throw new Error("Missing concurrent item");
      results[index] = await map(item, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => lane()),
  );
  return results;
}

function replayErrorSummary(error: Error): string {
  return `${error.name}: ${error.message}`;
}

/**
 * Replay every history against one bundle of `workflowsPath` and report each
 * history's outcome. Any nondeterminism or replay failure fails the batch, but
 * only after every history has been replayed and reported.
 */
export async function replayTemporalHistoryBatch(input: {
  histories: readonly TemporalReplayHistory[];
  workflowsPath: string;
  replay?: TemporalReplayBatch;
  log?: (line: string) => void;
}): Promise<TemporalReplayOutcome[]> {
  const log =
    input.log ??
    ((line: string) => {
      console.warn(line);
    });
  const replay: TemporalReplayBatch =
    input.replay ??
    ((options, histories) => Worker.runReplayHistories(options, histories));
  const outcomes: TemporalReplayOutcome[] = [];
  const failures: string[] = [];
  for await (const result of replay(
    { workflowsPath: input.workflowsPath },
    input.histories.map(({ workflowId, history }) => ({
      workflowId,
      history,
    })),
  )) {
    const requested = input.histories[outcomes.length];
    if (requested?.workflowId !== result.workflowId)
      throw new Error(
        `Replay result ${result.workflowId} does not match requested history ${String(requested?.workflowId)}`,
      );
    const runId = requested.runId ?? result.runId;
    outcomes.push({
      workflowId: result.workflowId,
      runId,
      error: result.error,
    });
    log(
      JSON.stringify({
        kind: "temporal-replay-history",
        workflowId: result.workflowId,
        runId,
        outcome: result.error === undefined ? "passed" : "failed",
        ...(result.error === undefined
          ? {}
          : { error: replayErrorSummary(result.error) }),
      }),
    );
    if (result.error !== undefined)
      failures.push(
        `${result.workflowId}/${runId} (${replayErrorSummary(result.error)})`,
      );
  }
  if (outcomes.length !== input.histories.length)
    throw new Error(
      `Replay ended after ${String(outcomes.length)} of ${String(input.histories.length)} histories`,
    );
  if (failures.length > 0)
    throw new Error(
      `Replay failed for ${String(failures.length)} of ${String(outcomes.length)} histories: ${failures.join("; ")}`,
    );
  return outcomes;
}

export async function replayTemporalHistories(input: {
  workflowIds: readonly TemporalReplayTarget[];
  emptyMessage: string;
  workflowsPath: string;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  if (input.workflowIds.length === 0) {
    throw new Error(input.emptyMessage);
  }
  const environment = input.environment ?? Bun.env;
  const namespace = TemporalReplayNamespaceSchema.parse(
    environment["TEMPORAL_NAMESPACE"],
  );
  const connection = await Connection.connect(
    temporalOperatorConnectionOptions(environment),
  );
  try {
    const client = new Client({
      connection,
      namespace,
    });
    const fetchStarted = performance.now();
    const histories = await mapWithConcurrency(
      input.workflowIds,
      HISTORY_FETCH_CONCURRENCY,
      async (target): Promise<TemporalReplayHistory> => {
        const { workflowId, runId } =
          typeof target === "string"
            ? { workflowId: target, runId: undefined }
            : target;
        return {
          workflowId,
          runId,
          history: await client.workflow
            .getHandle(workflowId, runId)
            .fetchHistory(),
        };
      },
    );
    const replayStarted = performance.now();
    console.warn(
      JSON.stringify({
        kind: "temporal-replay-phase",
        phase: "fetch-histories",
        histories: histories.length,
        durationMs: Math.round(replayStarted - fetchStarted),
      }),
    );
    try {
      await replayTemporalHistoryBatch({
        histories,
        workflowsPath: input.workflowsPath,
      });
    } finally {
      console.warn(
        JSON.stringify({
          kind: "temporal-replay-phase",
          phase: "replay-histories",
          histories: histories.length,
          durationMs: Math.round(performance.now() - replayStarted),
        }),
      );
    }
  } finally {
    await connection.close();
  }
}
