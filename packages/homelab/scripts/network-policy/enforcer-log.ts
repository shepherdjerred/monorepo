/**
 * The enforcer's denial evidence, read from Loki.
 *
 * kube-network-policies v1.1.2 runs at `--v=2` and logs every queued packet,
 * so on a busy node its container log rotates within about a minute and
 * `kubectl logs` sees only the current file. Loki keeps the whole stream.
 */
import { z } from "zod";
import {
  commandFailure,
  firstLine,
  type CommandResult,
  type CommandRunner,
} from "./command.ts";
import { deniedPacketId, type EnforcerLog } from "./namespace-checks.ts";

const ENFORCER_NAMESPACE = "kube-system";
const ENFORCER_DAEMONSET = "kube-flannel";
const ENFORCER_CONTAINER = "kube-network-policies";
const ENFORCER_STREAM = `namespace="${ENFORCER_NAMESPACE}", container="${ENFORCER_CONTAINER}"`;

export const DENIED_QUERY = `{${ENFORCER_STREAM}} |~ "Packet denied by (egress|ingress) policy"`;
/** The cluster's `max_entries_limit_per_query`; a larger limit is refused. */
export const LOKI_MAX_LINES = 5000;
/** Packet ids per `Evaluating packet` query, which keeps each regex short. */
export const IDS_PER_QUERY = 200;
/** A packet is evaluated just before its verdict; this covers the window's edge. */
const EVALUATION_LEAD_MS = 10_000;

const DaemonSetSchema = z.object({
  spec: z.object({
    template: z.object({
      spec: z.object({ containers: z.array(z.object({ name: z.string() })) }),
    }),
  }),
});

// gcx returns a value as an object, or as Loki's own [timestamp, line] pair.
const LokiValueSchema = z.union([
  z.object({ timestamp: z.string(), line: z.string() }),
  z
    .tuple([z.string(), z.string()])
    .transform(([timestamp, line]) => ({ timestamp, line })),
]);

const LokiStreamsSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    result: z.array(
      z.object({
        stream: z.object({ pod: z.string() }),
        values: z.array(LokiValueSchema),
      }),
    ),
  }),
});

const GcxErrorSchema = z.object({
  error: z.object({ summary: z.string(), details: z.string().optional() }),
});

type Entry = { pod: string; timestamp: bigint; line: string };
type Window = { from: Date; to: Date };
type LokiRead =
  | { ok: true; entries: Entry[]; limitReached: boolean }
  | { ok: false; reason: string };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** gcx prints its error as JSON on stdout; the LogQL is too long to repeat. */
function lokiFailure(result: CommandResult): string {
  const gcx = GcxErrorSchema.safeParse(parseJson(result.stdout));
  const detail = gcx.success
    ? (gcx.data.error.details ?? gcx.data.error.summary)
    : result.stderr.trim() || result.stdout.trim() || "(no output)";
  return `toolkit loki query exited ${String(result.exitCode)}: ${detail.replaceAll(/\s+/gu, " ").slice(0, 200)}`;
}

async function queryLoki(
  run: CommandRunner,
  expr: string,
  { from, to }: Window,
): Promise<LokiRead> {
  const command = [
    "toolkit",
    "loki",
    "query",
    expr,
    "--from",
    from.toISOString(),
    "--to",
    to.toISOString(),
    "--limit",
    String(LOKI_MAX_LINES),
    "-o",
    "json",
  ];
  const result = await run(command);
  if (result.exitCode !== 0) {
    return { ok: false, reason: lokiFailure(result) };
  }
  const parsed = LokiStreamsSchema.safeParse(parseJson(result.stdout));
  if (!parsed.success) {
    return { ok: false, reason: "unexpected Loki response" };
  }
  const entries = parsed.data.data.result.flatMap(({ stream, values }) =>
    values.map(({ timestamp, line }) => ({
      pod: stream.pod,
      timestamp: BigInt(timestamp),
      line,
    })),
  );
  return {
    ok: true,
    entries,
    limitReached: entries.length >= LOKI_MAX_LINES,
  };
}

function chunks<ITEM>(items: readonly ITEM[], size: number): ITEM[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

/** One LogQL query per agent pod and batch of packet ids. */
export function evaluationQueries(denied: readonly Entry[]): string[] {
  const idsByPod = new Map<string, Set<string>>();
  for (const { pod, line } of denied) {
    const id = deniedPacketId(line);
    if (id !== undefined) {
      idsByPod.set(pod, (idsByPod.get(pod) ?? new Set()).add(id));
    }
  }
  return [...idsByPod].flatMap(([pod, ids]) =>
    chunks([...ids], IDS_PER_QUERY).map(
      (batch) =>
        `{${ENFORCER_STREAM}, pod="${pod}"} |= "Evaluating packet" |~ "id=(${batch.join("|")})[^0-9]"`,
    ),
  );
}

/**
 * The denial lines and the `Evaluating packet` lines of the same packet ids,
 * in log order, each prefixed with its agent pod: packet ids are per agent.
 */
async function readDenialEvidence(
  run: CommandRunner,
  window: Window,
): Promise<LokiRead> {
  const denied = await queryLoki(run, DENIED_QUERY, window);
  if (!denied.ok) {
    return denied;
  }
  const lead = {
    from: new Date(window.from.getTime() - EVALUATION_LEAD_MS),
    to: window.to,
  };
  const evaluations = await Promise.all(
    evaluationQueries(denied.entries).map((expr) => queryLoki(run, expr, lead)),
  );
  const failed = evaluations.find((read) => !read.ok);
  if (failed !== undefined) {
    return failed;
  }
  const reads = [...evaluations, denied].filter((read) => read.ok);
  return {
    ok: true,
    // Stable: an evaluation logged in the same nanosecond stays first.
    entries: reads
      .flatMap((read) => read.entries)
      .toSorted((left, right) => Number(left.timestamp - right.timestamp)),
    limitReached: reads.some((read) => read.limitReached),
  };
}

/**
 * The enforcer's denial evidence for the last `minutes`, when the enforcer
 * exists. A failed read is "not available", never zero denials.
 */
export async function readEnforcerLog(
  run: CommandRunner,
  minutes: number,
  now: Date,
): Promise<EnforcerLog> {
  const get = [
    "kubectl",
    "--namespace",
    ENFORCER_NAMESPACE,
    "get",
    "daemonset",
    ENFORCER_DAEMONSET,
    "-o",
    "json",
  ];
  const found = await run(get);
  if (found.exitCode !== 0) {
    return { available: false, reason: firstLine(commandFailure(get, found)) };
  }
  const { containers } = DaemonSetSchema.parse(JSON.parse(found.stdout)).spec
    .template.spec;
  if (!containers.some(({ name }) => name === ENFORCER_CONTAINER)) {
    return {
      available: false,
      reason: `${ENFORCER_DAEMONSET} has no ${ENFORCER_CONTAINER} container (enforcement is not switched on)`,
    };
  }
  const read = await readDenialEvidence(run, {
    from: new Date(now.getTime() - minutes * 60_000),
    to: now,
  });
  return read.ok
    ? {
        available: true,
        lines: read.entries.map(({ pod, line }) => `[${pod}] ${line}`),
        minutes,
        limitReached: read.limitReached,
      }
    : { available: false, reason: read.reason };
}
