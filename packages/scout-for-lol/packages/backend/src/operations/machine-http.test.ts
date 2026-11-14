import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  OperationsMachineErrorSchema,
  OperationsMachineSubmitResponseSchema,
  OperationsQueuesSchema,
  OperationsIntentStatusSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { upsertIntent } from "#src/database/durable/intent-repository.ts";
import type { OperationsMachineCredential } from "#src/operations/machine-credential.ts";
import {
  firstOperator,
  instant,
  operationsIntentRecord,
} from "#src/testing/operations-fixtures.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testAccountId, testChannelId } from "#src/testing/test-ids.ts";

/**
 * The machine API is the operations console without a browser, so what has to
 * hold is that it is no weaker than the browser path and no different in
 * effect:
 *
 * - only a configured token authenticates, only an allowlisted operator is
 *   authorized, and the console flag can hide the surface but never grant it;
 * - a submission acts exactly once — a retry with the same key replays the
 *   stored result — and leaves the same audit row the console would, marked
 *   as a machine action with the caller's note.
 *
 * The harness swaps the database module, so the handler is imported after it.
 */

const OPERATOR = firstOperator();
const STRANGER = testAccountId("920000101");
const CHANNEL = testChannelId("420103");
const MATCH_ID = RiotMatchIdSchema.parse("NA1_5312279911");

const TOKEN = `sop_${"a".repeat(43)}`;
const STRANGER_TOKEN = `sop_${"b".repeat(43)}`;

function digest(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

function credential(
  token: string,
  operator: DiscordAccountId,
  label: string,
): OperationsMachineCredential {
  return { label, operator, tokenDigest: digest(token) };
}

const trpc = await createOfflineTrpcHarness("operations-machine-api-test");
const db = trpc.prisma;
const { handleOperationsMachineRoute } =
  await import("#src/operations/machine-http.ts");

const deps = {
  credentials: () => [
    credential(TOKEN, OPERATOR, "test-agent"),
    credential(STRANGER_TOKEN, STRANGER, "stranger-agent"),
  ],
};

async function call(
  path: string,
  init: {
    method?: string;
    token?: string | null;
    body?: unknown;
    contentType?: string;
  } = {},
): Promise<Response> {
  const url = new URL(`http://scout.test${path}`);
  const headers = new Headers({ "User-Agent": "machine-api-test" });
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) {
    headers.set("Content-Type", init.contentType ?? "application/json");
  }
  const response = await handleOperationsMachineRoute(
    new Request(url.href, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined
        ? {}
        : {
            body:
              typeof init.body === "string"
                ? init.body
                : JSON.stringify(init.body),
          }),
    }),
    url,
    deps,
  );
  if (response === null) throw new Error(`${path} was not routed`);
  return response;
}

async function errorOf(response: Response) {
  return OperationsMachineErrorSchema.parse(await response.json());
}

async function errorCode(response: Response): Promise<string> {
  const body = await errorOf(response);
  return body.error;
}

async function statusOf(
  path: string,
  init?: Parameters<typeof call>[1],
): Promise<number> {
  const response = await call(path, init);
  return response.status;
}

async function intentState(): Promise<string> {
  const row = await db.matchNotificationIntent.findUniqueOrThrow({
    where: { intentKey: INTENT_KEY },
  });
  return row.state;
}

const NONCE = NotificationAttemptNonceSchema.parse("run-501:attempt-1");
const INTENT_KEY = NotificationIntentKeySchema.parse(
  "notification:NA1_5312279911:channel:420103",
);

async function seedUnknownDelivery(): Promise<void> {
  const record = operationsIntentRecord({
    matchId: MATCH_ID,
    channelId: CHANNEL,
    key: INTENT_KEY,
    deadlineOffsetMs: 60 * 60_000,
    attemptCount: 1,
    state: {
      kind: "unknown-delivery",
      attemptNonce: NONCE,
      observedAt: instant(-30_000),
    },
  });
  const seeded = await upsertIntent(db, record);
  expect(seeded.outcome).toBe("applied");
}

function resolveNotDelivered(idempotencyKey: string) {
  return {
    payload: {
      kind: "ops_resolve_unknown_delivery",
      version: 1,
      intentKey: INTENT_KEY,
      answer: { outcome: "not-delivered", attemptNonce: NONCE },
    },
    idempotencyKey,
    note: "Window scan complete; no bot post carries the match ID.",
  };
}

beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
});

beforeEach(async () => {
  await db.confirmationIntent.deleteMany();
  await db.auditLog.deleteMany();
  await db.matchNotificationIntent.deleteMany();
  await db.matchObservation.deleteMany();
  resetFlagOverrides("scout_operations_console_enabled");
  // Global, so every denial below is the credential's or allowlist's doing.
  addFlagOverride("scout_operations_console_enabled", true, {});
});

afterAll(async () => {
  resetFlagOverrides("scout_operations_console_enabled");
  await shutdownFeatureFlags();
  await db.$disconnect();
});

describe("routing", () => {
  test("paths outside the operations prefix are not handled", async () => {
    const url = new URL("http://scout.test/api/scout-client/v1/check-ins");
    expect(
      await handleOperationsMachineRoute(new Request(url.href), url, deps),
    ).toBeNull();
  });
});

describe("authentication and authorization", () => {
  test.each([
    ["no Authorization header", null],
    ["an unknown sop_ token", `sop_${"c".repeat(43)}`],
    ["another scheme's token", `sct_${"a".repeat(43)}`],
  ])("%s is unauthorized", async (_name, token) => {
    const response = await call("/api/operations/v1/queues", { token });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(await errorCode(response)).toBe("unauthorized");
  });

  test("a deployment with no configured credential authenticates nobody", async () => {
    const url = new URL("http://scout.test/api/operations/v1/queues");
    const response = await handleOperationsMachineRoute(
      new Request(url.href, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      url,
      { credentials: () => [] },
    );
    expect(response?.status).toBe(401);
  });

  test("a token bound to a non-operator is forbidden with the flag fully on", async () => {
    await seedUnknownDelivery();
    const response = await call("/api/operations/v1/intents", {
      method: "POST",
      token: STRANGER_TOKEN,
      body: resolveNotDelivered("stranger-attempt-1"),
    });
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
    // Refused before anything was minted or moved.
    expect(await db.confirmationIntent.count()).toBe(0);
    expect(await intentState()).toBe("unknown-delivery");
  });

  test("an operator's token meets a hidden surface when the console flag is off", async () => {
    resetFlagOverrides("scout_operations_console_enabled");
    const response = await call("/api/operations/v1/intents", {
      method: "POST",
      body: resolveNotDelivered("flag-off-attempt-1"),
    });
    expect(response.status).toBe(404);
    expect(await db.confirmationIntent.count()).toBe(0);
  });
});

describe("submitting an operation", () => {
  test("resolving an unknown delivery acts once, audits the machine, and replays", async () => {
    await seedUnknownDelivery();
    const body = resolveNotDelivered("ai-601:resolve:run-501");

    const first = await call("/api/operations/v1/intents", {
      method: "POST",
      body,
    });
    expect(first.status).toBe(200);
    const executed = OperationsMachineSubmitResponseSchema.parse(
      await first.json(),
    );
    expect(executed).toMatchObject({
      kind: "executed",
      outcome: {
        kind: "delivery-resolved",
        intentKey: INTENT_KEY,
        intentState: "ready",
      },
      dispatch: null,
    });
    const row = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: INTENT_KEY },
    });
    expect(row).toMatchObject({ state: "ready", attemptCount: 1 });

    // The same audit row the console writes, marked as a machine action.
    const audits = await db.auditLog.findMany();
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit).toMatchObject({
      action: "OPS_DELIVERY_RESOLVE",
      actorDiscordId: OPERATOR,
      userAgent: "machine-api-test",
    });
    expect(JSON.parse(audit?.payload ?? "null")).toEqual({
      ...body.payload,
      outcome: "delivery-resolved",
      provenance: {
        via: "machine-token",
        credential: "test-agent",
        note: body.note,
      },
    });

    const retry = await call("/api/operations/v1/intents", {
      method: "POST",
      body,
    });
    expect(retry.status).toBe(200);
    expect(
      OperationsMachineSubmitResponseSchema.parse(await retry.json()),
    ).toEqual({
      kind: "already_consumed",
      intentId: executed.intentId,
      result: {
        kind: "delivery-resolved",
        intentKey: INTENT_KEY,
        intentState: "ready",
      },
    });
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.confirmationIntent.count()).toBe(1);

    const status = await call(
      `/api/operations/v1/intents/${executed.intentId}`,
    );
    expect(OperationsIntentStatusSchema.parse(await status.json())).toEqual({
      intentId: executed.intentId,
      state: "consumed",
      kind: "ops_resolve_unknown_delivery",
      expiresAt: expect.any(String),
      result: {
        kind: "delivery-resolved",
        intentKey: INTENT_KEY,
        intentState: "ready",
      },
    });
  });

  test("reusing a key for a different request is a conflict, not a replay", async () => {
    await seedUnknownDelivery();
    const key = "ai-601:conflict";
    expect(
      await statusOf("/api/operations/v1/intents", {
        method: "POST",
        body: resolveNotDelivered(key),
      }),
    ).toBe(200);
    const response = await call("/api/operations/v1/intents", {
      method: "POST",
      body: {
        payload: { kind: "ops_reconcile_pipeline", version: 1 },
        idempotencyKey: key,
        note: "Different request under the same key.",
      },
    });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("idempotency_conflict");
    expect(await db.auditLog.count()).toBe(1);
  });

  test.each([
    [
      "an unknown payload kind",
      {
        payload: { kind: "ops_delete_everything", version: 1 },
        idempotencyKey: "invalid-kind-1",
        note: "n",
      },
    ],
    [
      "a missing note",
      {
        payload: { kind: "ops_reconcile_pipeline", version: 1 },
        idempotencyKey: "missing-note-1",
      },
    ],
    [
      "an over-long note",
      {
        payload: { kind: "ops_reconcile_pipeline", version: 1 },
        idempotencyKey: "long-note-1",
        note: "x".repeat(281),
      },
    ],
    [
      "a malformed idempotency key",
      {
        payload: { kind: "ops_reconcile_pipeline", version: 1 },
        idempotencyKey: "no spaces",
        note: "n",
      },
    ],
    [
      "an unknown top-level field",
      {
        payload: { kind: "ops_reconcile_pipeline", version: 1 },
        idempotencyKey: "extra-field-1",
        note: "n",
        operator: STRANGER,
      },
    ],
  ])("%s is a 400 with issues", async (_name, body) => {
    const response = await call("/api/operations/v1/intents", {
      method: "POST",
      body,
    });
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.error).toBe("invalid_request");
    expect(error.issues?.length).toBeGreaterThan(0);
    expect(await db.confirmationIntent.count()).toBe(0);
  });

  test("a body that is not JSON is a 400 and a non-JSON content type is a 415", async () => {
    const notJson = await call("/api/operations/v1/intents", {
      method: "POST",
      body: "{not json",
    });
    expect(notJson.status).toBe(400);
    const wrongType = await call("/api/operations/v1/intents", {
      method: "POST",
      body: "{}",
      contentType: "text/plain",
    });
    expect(wrongType.status).toBe(415);
  });
});

describe("reads", () => {
  test("the queues carry the nonce an unknown-delivery answer must name", async () => {
    await seedUnknownDelivery();
    const response = await call("/api/operations/v1/queues?limit=5");
    expect(response.status).toBe(200);
    const queues = OperationsQueuesSchema.parse(await response.json());
    expect(queues.unknownDeliveries).toEqual([
      {
        intentKey: INTENT_KEY,
        matchId: MATCH_ID,
        attemptCount: 1,
        attemptNonce: NONCE,
        state: "unknown-delivery",
      },
    ]);
    expect(queues.pages.unknownDeliveries).toEqual({
      hasMore: false,
      cursor: null,
    });
  });

  test("queue query validation refuses unknown parameters and bad cursors", async () => {
    for (const query of [
      "limit=0",
      "everything=1",
      "cursor.unknownDeliveries=not-a-cursor",
      "cursor.nonexistentQueue=x",
    ]) {
      expect(await statusOf(`/api/operations/v1/queues?${query}`)).toBe(400);
    }
  });

  test("report deliveries list unresolved chunks", async () => {
    const response = await call("/api/operations/v1/report-deliveries");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chunks: [] });
  });

  test("another operator's or a missing intent reads as absent", async () => {
    const response = await call(
      `/api/operations/v1/intents/${crypto.randomUUID()}`,
    );
    expect(response.status).toBe(404);
  });

  test("wrong methods and unknown endpoints are refused", async () => {
    const wrongMethod = await call("/api/operations/v1/queues", {
      method: "POST",
      body: {},
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("GET");
    expect(await statusOf("/api/operations/v1/intents")).toBe(405);
    expect(await statusOf("/api/operations/v1/nothing-here")).toBe(404);
  });
});
