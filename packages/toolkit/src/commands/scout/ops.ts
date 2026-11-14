import { parseArgs } from "node:util";
import {
  OperationsIntentPayloadSchema,
  type OperationsIntentPayload,
} from "@scout-for-lol/data/model/operations/operations-intent.ts";
import {
  OPERATIONS_QUEUE_NAMES,
  OperationsIdempotencyKeySchema,
  OperationsMachineSubmitRequestSchema,
  OperationsQueueNameSchema,
  type OperationsMachineSubmitRequest,
  type OperationsQueueName,
  type OperationsQueues,
  type OperationsReportDeliveries,
} from "@scout-for-lol/data/model/operations/operations-machine-api.ts";
import {
  SCOUT_ENVIRONMENTS,
  defaultIdempotencyKey,
  submissionExitCode,
  type ScoutEnvironment,
  type ScoutOperationsClient,
} from "#lib/scout-operations/client.ts";

export const SCOUT_OPS_HELP = `toolkit scout ops - Scout's durable-pipeline operations console, without a browser

Usage:
  toolkit scout ops queues --environment beta|prod [--limit N] [--cursor QUEUE=TOKEN]... [--json]
  toolkit scout ops report-deliveries --environment beta|prod [--json]
  toolkit scout ops status <INTENT_ID> --environment beta|prod [--json]
  toolkit scout ops resolve-unknown --environment beta|prod --intent-key KEY --nonce NONCE
      (--not-delivered | --delivered --message-id ID --delivered-at ISO) --note TEXT
      [--idempotency-key KEY] [--dry-run] [--json]
  toolkit scout ops resolve-report --environment beta|prod --run-id N --channel-id ID
      --chunk-index N --nonce NONCE
      (--not-delivered | --delivered --message-id ID --delivered-at ISO) --note TEXT
      [--idempotency-key KEY] [--dry-run] [--json]
  toolkit scout ops submit --environment beta|prod --file PAYLOAD.json --note TEXT
      [--idempotency-key KEY] [--dry-run] [--json]

Every action runs the console's own prepare-and-confirm path in one request, as
the operator the stage's token is bound to in Scout's source, and is audited
with --note. The default idempotency key is derived from the payload, so
re-running an identical command replays the first result; pass a fresh
--idempotency-key to repeat an operation deliberately.

Exit status: 0 applied (now or by an earlier request with the same key),
3 claimed and audited but refused by the pipeline, 1 expired unclaimed intent
(nothing ran), 2 request or authorization failure.

Credentials: SCOUT_OPERATIONS_TOKEN_BETA / SCOUT_OPERATIONS_TOKEN_PROD.`;

export type ScoutOpsInvocation =
  | {
      readonly action: "queues";
      readonly limit: number | undefined;
      readonly after: Partial<Record<OperationsQueueName, string>>;
    }
  | { readonly action: "report-deliveries" }
  | { readonly action: "status"; readonly intentId: string }
  | {
      readonly action: "submit";
      readonly request: OperationsMachineSubmitRequest;
      readonly dryRun: boolean;
    };

export type ParsedScoutOps = {
  readonly environment: ScoutEnvironment;
  readonly json: boolean;
  readonly url: string | undefined;
  readonly invocation: ScoutOpsInvocation;
};

const OPTIONS = {
  environment: { type: "string" },
  url: { type: "string" },
  json: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  limit: { type: "string" },
  cursor: { type: "string", multiple: true },
  "intent-key": { type: "string" },
  nonce: { type: "string" },
  delivered: { type: "boolean", default: false },
  "not-delivered": { type: "boolean", default: false },
  "message-id": { type: "string" },
  "delivered-at": { type: "string" },
  "run-id": { type: "string" },
  "channel-id": { type: "string" },
  "chunk-index": { type: "string" },
  note: { type: "string" },
  "idempotency-key": { type: "string" },
  file: { type: "string" },
} as const;

type Values = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS }>
>["values"];

function required(values: Values, name: keyof Values): string {
  const value = values[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function integer(values: Values, name: keyof Values): number {
  const raw = required(values, name);
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be an integer`);
  return Number(raw);
}

function environmentOf(values: Values): ScoutEnvironment {
  const raw = values.environment;
  const match = SCOUT_ENVIRONMENTS.find((environment) => environment === raw);
  if (match === undefined) {
    throw new Error("--environment beta|prod is required");
  }
  return match;
}

/** `--delivered --message-id --delivered-at` or `--not-delivered`. */
function deliveryAnswer(values: Values) {
  if (values.delivered === values["not-delivered"]) {
    throw new Error("Pass exactly one of --delivered or --not-delivered");
  }
  return values.delivered
    ? {
        outcome: "delivered" as const,
        messageId: required(values, "message-id"),
        deliveredAt: required(values, "delivered-at"),
      }
    : { outcome: "not-delivered" as const };
}

function cursors(values: Values): Partial<Record<OperationsQueueName, string>> {
  const after: Partial<Record<OperationsQueueName, string>> = {};
  for (const entry of values.cursor ?? []) {
    const separator = entry.indexOf("=");
    const queue = OperationsQueueNameSchema.safeParse(
      separator === -1 ? entry : entry.slice(0, separator),
    );
    if (separator === -1 || !queue.success) {
      throw new Error(
        `--cursor takes QUEUE=TOKEN with QUEUE one of ${OPERATIONS_QUEUE_NAMES.join(", ")}`,
      );
    }
    after[queue.data] = entry.slice(separator + 1);
  }
  return after;
}

async function payloadFor(
  action: string,
  values: Values,
): Promise<OperationsIntentPayload> {
  switch (action) {
    case "resolve-unknown": {
      const answer = deliveryAnswer(values);
      const attemptNonce = required(values, "nonce");
      return OperationsIntentPayloadSchema.parse({
        kind: "ops_resolve_unknown_delivery",
        version: 1,
        intentKey: required(values, "intent-key"),
        answer: { ...answer, attemptNonce },
      });
    }
    case "resolve-report":
      return OperationsIntentPayloadSchema.parse({
        kind: "ops_resolve_report_delivery",
        version: 1,
        runId: integer(values, "run-id"),
        channelId: required(values, "channel-id"),
        chunkIndex: integer(values, "chunk-index"),
        attemptNonce: required(values, "nonce"),
        answer: deliveryAnswer(values),
      });
    default: {
      const file = Bun.file(required(values, "file"));
      if (!(await file.exists())) {
        throw new Error(`--file ${file.name ?? ""} does not exist`);
      }
      return OperationsIntentPayloadSchema.parse(await file.json());
    }
  }
}

export async function parseScoutOpsArgs(
  args: readonly string[],
): Promise<ParsedScoutOps> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  const [action, ...rest] = positionals;
  const environment = environmentOf(values);
  const base = { environment, json: values.json, url: values.url };
  const noOperands = () => {
    if (rest.length > 0)
      throw new Error(`Unexpected argument: ${rest[0] ?? ""}`);
  };

  if (action === undefined) {
    throw new Error(`An action is required.\n\n${SCOUT_OPS_HELP}`);
  }
  switch (action) {
    case "queues":
      noOperands();
      return {
        ...base,
        invocation: {
          action,
          limit:
            values.limit === undefined ? undefined : integer(values, "limit"),
          after: cursors(values),
        },
      };
    case "report-deliveries":
      noOperands();
      return { ...base, invocation: { action } };
    case "status": {
      const [intentId, ...extra] = rest;
      if (intentId === undefined || extra.length > 0) {
        throw new Error("Usage: toolkit scout ops status <INTENT_ID>");
      }
      return { ...base, invocation: { action, intentId } };
    }
    case "resolve-unknown":
    case "resolve-report":
    case "submit": {
      noOperands();
      const payload = await payloadFor(action, values);
      const request = OperationsMachineSubmitRequestSchema.parse({
        payload,
        idempotencyKey: OperationsIdempotencyKeySchema.parse(
          values["idempotency-key"] ?? defaultIdempotencyKey(payload),
        ),
        note: required(values, "note"),
      });
      return {
        ...base,
        invocation: { action: "submit", request, dryRun: values["dry-run"] },
      };
    }
    default:
      throw new Error(
        `Unknown scout ops action: ${action}\n\n${SCOUT_OPS_HELP}`,
      );
  }
}

function renderQueues(queues: OperationsQueues): string {
  const lines = OPERATIONS_QUEUE_NAMES.map((name) => {
    const page = queues.pages[name];
    return `${name}: ${String(queues[name].length)}${page.hasMore ? "+" : ""}`;
  });
  for (const row of queues.unknownDeliveries) {
    lines.push(
      `  unknown ${row.intentKey} nonce=${row.attemptNonce} attempts=${String(row.attemptCount)}`,
    );
  }
  return lines.join("\n");
}

function renderReportDeliveries(
  deliveries: OperationsReportDeliveries,
): string {
  return deliveries.chunks.length === 0
    ? "No unresolved report chunks."
    : deliveries.chunks
        .map(
          (chunk) =>
            `run=${String(chunk.runId)} channel=${chunk.channelId} chunk=${String(chunk.chunkIndex)} state=${chunk.state} nonce=${chunk.nonce} updated=${chunk.updatedAt}`,
        )
        .join("\n");
}

/** Run one parsed invocation; returns the process exit status. */
export async function runScoutOps(
  parsed: ParsedScoutOps,
  client: () => ScoutOperationsClient,
  print: (line: string) => void,
): Promise<number> {
  const emit = (value: unknown, human: () => string) => {
    print(parsed.json ? JSON.stringify(value) : human());
  };
  const { invocation } = parsed;
  switch (invocation.action) {
    case "queues": {
      const queues = await client().queues({
        limit: invocation.limit,
        after: invocation.after,
      });
      emit(queues, () => renderQueues(queues));
      return 0;
    }
    case "report-deliveries": {
      const deliveries = await client().reportDeliveries();
      emit(deliveries, () => renderReportDeliveries(deliveries));
      return 0;
    }
    case "status": {
      const status = await client().intentStatus(invocation.intentId);
      emit(status, () => JSON.stringify(status, null, 2));
      return 0;
    }
    case "submit": {
      if (invocation.dryRun) {
        emit(
          {
            dryRun: true,
            environment: parsed.environment,
            ...invocation.request,
          },
          () => JSON.stringify(invocation.request, null, 2),
        );
        return 0;
      }
      const response = await client().submit(invocation.request);
      emit(response, () => JSON.stringify(response, null, 2));
      return submissionExitCode(response);
    }
  }
}
