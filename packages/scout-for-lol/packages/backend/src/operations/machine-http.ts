import {
  OPERATIONS_MACHINE_API_PREFIX,
  OPERATIONS_QUEUE_NAMES,
  OperationsIntentStatusSchema,
  OperationsMachineErrorSchema,
  OperationsMachineSubmitRequestSchema,
  OperationsMachineSubmitResponseSchema,
  OperationsQueuesSchema,
  OperationsReportDeliveriesSchema,
  type OperationsMachineError,
  type OperationsQueueName,
} from "@scout-for-lol/data";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import {
  authenticateOperationsMachine,
  configuredOperationsMachineCredentials,
  type OperationsMachineCredential,
} from "#src/operations/machine-credential.ts";
import {
  confirmOperationsIntent,
  findOperationsIntent,
  listUnresolvedReportDeliveries,
  operationsConsoleEnabled,
  operationsIntentStatus,
  prepareOperationsIntent,
} from "#src/operations/operations-commands.ts";
import {
  OPERATIONS_QUEUE_MAX,
  readOperationsQueues,
} from "#src/operations/operations-reads.ts";
import { decodeQueueCursor } from "#src/operations/queue-cursor.ts";
import { isScoutOperator } from "#src/operations/operator-allowlist.ts";

/**
 * The operations console for a machine caller: bearer-authenticated JSON over
 * the same functions the browser console's tRPC procedures call.
 *
 * Authorization is decided in the same order as the browser path, for the
 * same reasons (see `trpc/router/operations/operations-access.ts`):
 *
 * 1. The token must match a configured credential (401 otherwise).
 * 2. The credential's operator must be on the Git allowlist (403), checked on
 *    every request so removing an operator also retires their credential.
 * 3. The console flag must be on for that operator (404, as every disabled
 *    flag-gated surface here hides itself). The flag can remove the surface,
 *    never grant it.
 *
 * `POST /intents` is prepare and confirm in one request. The intent is minted
 * for the credential's operator under the caller's idempotency key and
 * claimed immediately, so a retry with the same key and payload finds the
 * consumed intent and returns its stored result without acting again.
 */

const logger = createLogger("operations-machine-api");

const MAX_BODY_BYTES = 16 * 1024;
const MACHINE_IDEMPOTENCY_NAMESPACE = "ops-machine:";
const INTENT_PATH = new RegExp(
  `^${OPERATIONS_MACHINE_API_PREFIX}/intents/([0-9a-f-]{36})$`,
);
const CURSOR_PARAM_PREFIX = "cursor.";

export type OperationsMachineDeps = {
  readonly credentials: () => readonly OperationsMachineCredential[];
};

const defaultDeps: OperationsMachineDeps = {
  credentials: configuredOperationsMachineCredentials,
};

type Authorized = {
  readonly credential: OperationsMachineCredential;
  readonly request: Request;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function refuse(
  error: OperationsMachineError["error"],
  message: string,
  status: number,
  extra?: {
    issues?: OperationsMachineError["issues"];
    headers?: Readonly<Record<string, string>>;
  },
): Response {
  const body = OperationsMachineErrorSchema.parse({
    error,
    message,
    ...(extra?.issues === undefined ? {} : { issues: extra.issues }),
  });
  const response = json(body, status);
  for (const [name, value] of Object.entries(extra?.headers ?? {})) {
    response.headers.set(name, value);
  }
  return response;
}

function invalid(error: z.ZodError): Response {
  return refuse("invalid_request", "The request did not validate.", 400, {
    issues: error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}

class MachineRequestError extends Error {
  constructor(readonly response: Response) {
    super("operations machine request refused");
  }
}

function bodyTooLarge(): MachineRequestError {
  return new MachineRequestError(
    refuse("payload_too_large", "Request body is too large.", 413),
  );
}

async function boundedJsonBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.startsWith("application/json") !== true
  ) {
    throw new MachineRequestError(
      refuse(
        "unsupported_media_type",
        "Content-Type must be application/json.",
        415,
      ),
    );
  }
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_BODY_BYTES) {
    throw bodyTooLarge();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw bodyTooLarge();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MachineRequestError(
      refuse("invalid_request", "Request body is not valid JSON.", 400),
    );
  }
}

const QueuesQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OPERATIONS_QUEUE_MAX)
    .default(OPERATIONS_QUEUE_MAX),
  after: z
    .partialRecord(
      z.enum(OPERATIONS_QUEUE_NAMES),
      z
        .string()
        .min(1)
        .refine((token) => {
          try {
            decodeQueueCursor(token);
            return true;
          } catch {
            return false;
          }
        }, "Not a queue cursor"),
    )
    .optional(),
});

/** `?limit=N&cursor.<queue>=<token>` into the console's queue-read input. */
function queuesQuery(url: URL) {
  const after: Partial<Record<string, string>> = {};
  const rest: Record<string, string> = {};
  for (const [name, value] of url.searchParams) {
    if (name.startsWith(CURSOR_PARAM_PREFIX)) {
      after[name.slice(CURSOR_PARAM_PREFIX.length)] = value;
    } else {
      rest[name] = value;
    }
  }
  return QueuesQuerySchema.safeParse({
    ...rest,
    ...(Object.keys(after).length === 0 ? {} : { after }),
  });
}

async function handleQueues(url: URL): Promise<Response> {
  const query = queuesQuery(url);
  if (!query.success) return invalid(query.error);
  const after: Partial<Record<OperationsQueueName, string>> =
    query.data.after ?? {};
  const queues = await readOperationsQueues({
    limit: query.data.limit,
    now: new Date(),
    after,
  });
  return json(OperationsQueuesSchema.parse(queues));
}

async function handleReportDeliveries(): Promise<Response> {
  const rows = await listUnresolvedReportDeliveries();
  return json(
    OperationsReportDeliveriesSchema.parse({
      chunks: rows.map((row) => ({
        runId: row.reportRunId,
        channelId: row.channelId,
        chunkIndex: row.chunkIndex,
        serverId: row.serverId,
        state: row.state,
        nonce: row.nonce,
        messageId: row.messageId,
        sendStartedAt: row.sendStartedAt?.toISOString() ?? null,
        lastError: row.lastError,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    }),
  );
}

async function handleIntentStatus(
  intentId: string,
  authorized: Authorized,
): Promise<Response> {
  const loaded = await findOperationsIntent({
    intentId,
    operator: authorized.credential.operator,
  });
  if (loaded === null) {
    return refuse("not_found", "Operations confirmation not found.", 404);
  }
  return json(
    OperationsIntentStatusSchema.parse({
      intentId,
      ...operationsIntentStatus(loaded, new Date()),
    }),
  );
}

function requestOrigin(request: Request) {
  return {
    ipAddress:
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For"),
    userAgent: request.headers.get("User-Agent"),
  };
}

async function handleSubmit(authorized: Authorized): Promise<Response> {
  const input = OperationsMachineSubmitRequestSchema.safeParse(
    await boundedJsonBody(authorized.request),
  );
  if (!input.success) return invalid(input.error);
  const { payload, idempotencyKey, note } = input.data;
  const { credential } = authorized;

  const created = await prepareOperationsIntent({
    operator: credential.operator,
    payload,
    // Namespaced so a caller's key can never meet a browser prepare's UUID or
    // another surface's key in the shared intent table.
    idempotencyKey: `${MACHINE_IDEMPOTENCY_NAMESPACE}${idempotencyKey}`,
    now: new Date(),
  });
  if (created.kind === "idempotency_conflict") {
    return refuse(
      "idempotency_conflict",
      "This idempotency key was already used for a different request.",
      409,
    );
  }

  const intentId = created.intent.id;
  const result = await confirmOperationsIntent({
    // The stored payload equals this one: `createConfirmationIntent` refuses a
    // reused key whose payload differs.
    loaded: { intent: created.intent, payload },
    actor: {
      operator: credential.operator,
      request: requestOrigin(authorized.request),
      provenance: {
        via: "machine-token",
        credential: credential.label,
        note,
      },
    },
  });
  logger.info("Operations machine submission", {
    credential: credential.label,
    kind: payload.kind,
    intentId,
    result: result.kind,
    outcome: result.kind === "executed" ? result.outcome.kind : undefined,
  });
  return json(
    OperationsMachineSubmitResponseSchema.parse({ ...result, intentId }),
  );
}

async function route(url: URL, authorized: Authorized): Promise<Response> {
  const { method } = authorized.request;
  const path = url.pathname;
  const methodNotAllowed = (allow: string) =>
    refuse("method_not_allowed", `Use ${allow}.`, 405, {
      headers: { Allow: allow },
    });

  if (path === `${OPERATIONS_MACHINE_API_PREFIX}/queues`) {
    return method === "GET" ? await handleQueues(url) : methodNotAllowed("GET");
  }
  if (path === `${OPERATIONS_MACHINE_API_PREFIX}/report-deliveries`) {
    return method === "GET"
      ? await handleReportDeliveries()
      : methodNotAllowed("GET");
  }
  if (path === `${OPERATIONS_MACHINE_API_PREFIX}/intents`) {
    return method === "POST"
      ? await handleSubmit(authorized)
      : methodNotAllowed("POST");
  }
  const intentMatch = INTENT_PATH.exec(path);
  const intentId = intentMatch?.[1];
  if (intentId !== undefined) {
    return method === "GET"
      ? await handleIntentStatus(intentId, authorized)
      : methodNotAllowed("GET");
  }
  return refuse("not_found", "No such operations endpoint.", 404);
}

/**
 * Serve `/api/operations/v1/*`, or `null` for any other path.
 */
export async function handleOperationsMachineRoute(
  request: Request,
  url: URL,
  deps: OperationsMachineDeps = defaultDeps,
): Promise<Response | null> {
  if (
    url.pathname !== OPERATIONS_MACHINE_API_PREFIX &&
    !url.pathname.startsWith(`${OPERATIONS_MACHINE_API_PREFIX}/`)
  ) {
    return null;
  }
  const credential = authenticateOperationsMachine(
    request.headers.get("Authorization"),
    deps.credentials(),
  );
  if (credential === null) {
    return refuse(
      "unauthorized",
      "A valid operations machine token is required.",
      401,
      { headers: { "WWW-Authenticate": 'Bearer realm="scout-operations"' } },
    );
  }
  if (!isScoutOperator(credential.operator)) {
    logger.warn("Operations machine credential bound to a non-operator", {
      credential: credential.label,
    });
    return refuse(
      "forbidden",
      "This credential's operator is not a Scout operator.",
      403,
    );
  }
  if (!(await operationsConsoleEnabled(credential.operator))) {
    return refuse("not_found", "Scout operations are unavailable.", 404);
  }
  try {
    return await route(url, { credential, request });
  } catch (error) {
    if (error instanceof MachineRequestError) return error.response;
    throw error;
  }
}
