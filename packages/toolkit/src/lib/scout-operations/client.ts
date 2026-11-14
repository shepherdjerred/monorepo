import {
  OPERATIONS_MACHINE_API_PREFIX,
  OperationsIntentStatusSchema,
  OperationsMachineErrorSchema,
  OperationsMachineSubmitResponseSchema,
  OperationsQueuesSchema,
  OperationsReportDeliveriesSchema,
  type OperationsIntentStatus,
  type OperationsMachineError,
  type OperationsMachineSubmitRequest,
  type OperationsMachineSubmitResponse,
  type OperationsQueueName,
  type OperationsQueues,
  type OperationsReportDeliveries,
} from "@scout-for-lol/data/model/operations/operations-machine-api.ts";
import type { OperationsIntentPayload } from "@scout-for-lol/data/model/operations/operations-intent.ts";
import { z } from "zod";

/**
 * Client for Scout's operations machine API (`/api/operations/v1`).
 *
 * The backend authorizes the token's Git-bound operator on every request, so
 * this client carries no notion of who it acts as. Responses are parsed with
 * the contract the backend serves them through.
 */

export const SCOUT_ENVIRONMENTS = ["beta", "prod"] as const;
export type ScoutEnvironment = (typeof SCOUT_ENVIRONMENTS)[number];

export const SCOUT_OPERATIONS_ORIGINS: Readonly<
  Record<ScoutEnvironment, string>
> = {
  beta: "https://beta.scout-for-lol.com",
  prod: "https://scout-for-lol.com",
};

/** The registered credential holding each stage's `sop_` token. */
export const SCOUT_OPERATIONS_TOKEN_CREDENTIALS = {
  beta: "SCOUT_OPERATIONS_TOKEN_BETA",
  prod: "SCOUT_OPERATIONS_TOKEN_PROD",
} as const satisfies Record<ScoutEnvironment, string>;

export class ScoutOperationsError extends Error {
  constructor(
    readonly status: number,
    readonly body: OperationsMachineError | null,
  ) {
    super(
      body === null
        ? `Scout operations API answered HTTP ${String(status)}`
        : `Scout operations API answered HTTP ${String(status)} ${body.error}: ${body.message}${
            body.issues === undefined
              ? ""
              : body.issues
                  .map(
                    (issue) =>
                      `\n  ${issue.path || "(root)"}: ${issue.message}`,
                  )
                  .join("")
          }`,
    );
  }
}

export type ScoutOperationsClient = {
  readonly queues: (args?: {
    limit?: number | undefined;
    after?: Partial<Record<OperationsQueueName, string>> | undefined;
  }) => Promise<OperationsQueues>;
  readonly reportDeliveries: () => Promise<OperationsReportDeliveries>;
  readonly intentStatus: (intentId: string) => Promise<OperationsIntentStatus>;
  readonly submit: (
    request: OperationsMachineSubmitRequest,
  ) => Promise<OperationsMachineSubmitResponse>;
};

/** An error answer's body, or `null` when the server sent no JSON. */
function parseJsonOrNull(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function scoutOperationsClient(options: {
  origin: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}): ScoutOperationsClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  const base = `${options.origin.replace(/\/$/, "")}${OPERATIONS_MACHINE_API_PREFIX}`;

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: { method: "POST"; body: unknown },
  ): Promise<T> {
    const response = await fetcher(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/json",
        "User-Agent": "toolkit-scout-ops",
        ...(init === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const body = parseJsonOrNull(await response.text());
    if (!response.ok) {
      const parsed = OperationsMachineErrorSchema.safeParse(body);
      throw new ScoutOperationsError(
        response.status,
        parsed.success ? parsed.data : null,
      );
    }
    return schema.parse(body);
  }

  return {
    queues: async (args = {}) => {
      const params = new URLSearchParams();
      if (args.limit !== undefined) params.set("limit", String(args.limit));
      for (const [queue, cursor] of Object.entries(args.after ?? {})) {
        params.set(`cursor.${queue}`, cursor);
      }
      const query = params.size === 0 ? "" : `?${params.toString()}`;
      return await request(`/queues${query}`, OperationsQueuesSchema);
    },
    reportDeliveries: async () =>
      await request("/report-deliveries", OperationsReportDeliveriesSchema),
    intentStatus: async (intentId) =>
      await request(
        `/intents/${encodeURIComponent(intentId)}`,
        OperationsIntentStatusSchema,
      ),
    submit: async (body) =>
      await request("/intents", OperationsMachineSubmitResponseSchema, {
        method: "POST",
        body,
      }),
  };
}

/**
 * The default retry key for a payload: stable for an identical payload, so a
 * re-run of the same command replays the first result instead of acting
 * twice. Repeating an operation on purpose (a second reconcile) needs an
 * explicit, fresh key.
 */
export function defaultIdempotencyKey(
  payload: OperationsIntentPayload,
): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return `toolkit:${digest.slice(0, 40)}`;
}

/** Outcomes that were claimed and audited but changed nothing. */
const REFUSED_OUTCOMES: ReadonlySet<string> = new Set([
  "machine-refused",
  "target-not-found",
  "not-drivable",
]);

const StoredOutcomeSchema = z.looseObject({ kind: z.string() });

/**
 * The command's exit status for a submission: 0 when the operation took
 * effect (now or on the first request with this key), 3 when the backend
 * claimed it but refused to change anything, 4 when it authorized a Workflow
 * start but the handoff was unavailable (nothing is running), 1 when an earlier unclaimed
 * intent expired and nothing ran.
 */
export function submissionExitCode(
  response: OperationsMachineSubmitResponse,
): number {
  switch (response.kind) {
    case "executed":
      if (REFUSED_OUTCOMES.has(response.outcome.kind)) {
        return 3;
      }
      return response.outcome.kind === "start-authorized" &&
        response.dispatch?.outcome === "unavailable"
        ? 4
        : 0;
    case "already_consumed": {
      const stored = StoredOutcomeSchema.safeParse(response.result);
      return stored.success && REFUSED_OUTCOMES.has(stored.data.kind) ? 3 : 0;
    }
    case "intent_expired":
      return 1;
  }
}
