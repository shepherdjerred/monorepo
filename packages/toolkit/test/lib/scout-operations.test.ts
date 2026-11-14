import { describe, expect, test } from "vitest";
import { CREDENTIAL_REGISTRY } from "#lib/credential-registry.ts";
import {
  SCOUT_OPERATIONS_TOKEN_CREDENTIALS,
  ScoutOperationsError,
  defaultIdempotencyKey,
  scoutOperationsClient,
  submissionExitCode,
} from "#lib/scout-operations/client.ts";
import {
  parseScoutOpsArgs,
  runScoutOps,
  type ParsedScoutOps,
} from "#commands/scout/ops.ts";

const INTENT_KEY = "notification:NA1_5312279829:channel:420003";
const NONCE = "run-77:attempt-2";
const INTENT_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";

type Captured = { url: string; init: RequestInit | undefined };

function fakeFetch(
  status: number,
  body: unknown,
  captured: Captured[],
): typeof globalThis.fetch {
  const fetcher = (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      init,
    });
    return Promise.resolve(Response.json(body, { status }));
  };
  return Object.assign(fetcher, {
    preconnect: globalThis.fetch.preconnect.bind(globalThis.fetch),
  });
}

describe("credential registry", () => {
  test("each stage's token resolves from its own Scout item field", () => {
    const vault = "op://v64ocnykdqju4ui6j6pua56xw4";
    const betaItem = "rtu44pohnp5ixdp2njuv5f6t2e";
    const prodItem = "pacrc4wfbtct4y3qazkvazop5a";
    const field = "SCOUT_OPERATIONS_TOKEN";
    expect(
      CREDENTIAL_REGISTRY[SCOUT_OPERATIONS_TOKEN_CREDENTIALS.beta]?.source,
    ).toEqual({ kind: "op", ref: `${vault}/${betaItem}/${field}` });
    expect(
      CREDENTIAL_REGISTRY[SCOUT_OPERATIONS_TOKEN_CREDENTIALS.prod]?.source,
    ).toEqual({ kind: "op", ref: `${vault}/${prodItem}/${field}` });
  });
});

describe("argument parsing", () => {
  test("resolve-unknown builds the console's payload with a stable default key", async () => {
    const args = [
      "resolve-unknown",
      "--environment",
      "prod",
      "--intent-key",
      INTENT_KEY,
      "--nonce",
      NONCE,
      "--not-delivered",
      "--note",
      "Window scan complete; no bot post carries the match ID.",
    ];
    const first = await parseScoutOpsArgs(args);
    const second = await parseScoutOpsArgs(args);
    expect(first.environment).toBe("prod");
    expect(first.invocation).toMatchObject({
      action: "submit",
      dryRun: false,
      request: {
        payload: {
          kind: "ops_resolve_unknown_delivery",
          version: 1,
          intentKey: INTENT_KEY,
          answer: { outcome: "not-delivered", attemptNonce: NONCE },
        },
        note: "Window scan complete; no bot post carries the match ID.",
      },
    });
    // Re-running the identical command must replay, never act twice.
    expect(first.invocation).toEqual(second.invocation);
  });

  test("resolve-report with a delivered answer carries the message", async () => {
    const parsed = await parseScoutOpsArgs([
      "resolve-report",
      "--environment",
      "beta",
      "--run-id",
      "346",
      "--channel-id",
      "123456789012345678",
      "--chunk-index",
      "0",
      "--nonce",
      "0123456789abcdef01234567",
      "--delivered",
      "--message-id",
      "223456789012345678",
      "--delivered-at",
      "2026-11-12T18:04:05.000Z",
      "--note",
      "Matched post by run ID.",
      "--idempotency-key",
      "ai-601:run-346:chunk-0",
    ]);
    expect(parsed.invocation).toEqual({
      action: "submit",
      dryRun: false,
      request: {
        payload: {
          kind: "ops_resolve_report_delivery",
          version: 1,
          runId: 346,
          channelId: "123456789012345678",
          chunkIndex: 0,
          attemptNonce: "0123456789abcdef01234567",
          answer: {
            outcome: "delivered",
            messageId: "223456789012345678",
            deliveredAt: "2026-11-12T18:04:05.000Z",
          },
        },
        idempotencyKey: "ai-601:run-346:chunk-0",
        note: "Matched post by run ID.",
      },
    });
  });

  test.each([
    [["queues"], /--environment/],
    [["queues", "--environment", "staging"], /--environment/],
    [
      [
        "resolve-unknown",
        "--environment",
        "beta",
        "--intent-key",
        INTENT_KEY,
        "--nonce",
        NONCE,
        "--note",
        "n",
      ],
      /exactly one of --delivered or --not-delivered/,
    ],
    [
      [
        "resolve-unknown",
        "--environment",
        "beta",
        "--intent-key",
        INTENT_KEY,
        "--nonce",
        NONCE,
        "--not-delivered",
      ],
      /--note is required/,
    ],
    [["queues", "--environment", "beta", "--cursor", "nope=x"], /--cursor/],
    [["frobnicate", "--environment", "beta"], /Unknown scout ops action/],
  ])("%j is refused", async (args, message) => {
    await expect(parseScoutOpsArgs(args)).rejects.toThrow(message);
  });

  test("queue cursors are passed per queue", async () => {
    const parsed = await parseScoutOpsArgs([
      "queues",
      "--environment",
      "beta",
      "--limit",
      "10",
      "--cursor",
      "unknownDeliveries=2026-11-12T00:00:00.000Z|key",
    ]);
    expect(parsed.invocation).toEqual({
      action: "queues",
      limit: 10,
      after: { unknownDeliveries: "2026-11-12T00:00:00.000Z|key" },
    });
  });
});

describe("client", () => {
  test("submit sends the bearer token and JSON body and parses the answer", async () => {
    const captured: Captured[] = [];
    const client = scoutOperationsClient({
      origin: "https://beta.scout-for-lol.com/",
      token: "sop_test",
      fetch: fakeFetch(
        200,
        {
          kind: "executed",
          intentId: INTENT_ID,
          outcome: {
            kind: "delivery-resolved",
            intentKey: INTENT_KEY,
            intentState: "ready",
          },
          dispatch: null,
        },
        captured,
      ),
    });
    const request = {
      payload: {
        kind: "ops_reconcile_pipeline" as const,
        version: 1 as const,
      },
      idempotencyKey: "test-key-0001",
      note: "n",
    };
    const response = await client.submit(request);
    expect(response.kind).toBe("executed");
    expect(captured[0]?.url).toBe(
      "https://beta.scout-for-lol.com/api/operations/v1/intents",
    );
    expect(captured[0]?.init?.method).toBe("POST");
    expect(captured[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer sop_test",
      "Content-Type": "application/json",
    });
    const sent = captured[0]?.init?.body;
    if (typeof sent !== "string")
      throw new TypeError("submit sent no JSON body");
    expect(JSON.parse(sent)).toEqual(request);
  });

  test("queues encode per-queue cursors as cursor.<queue>", async () => {
    const captured: Captured[] = [];
    const empty = { hasMore: false, cursor: null };
    const client = scoutOperationsClient({
      origin: "https://scout-for-lol.com",
      token: "sop_test",
      fetch: fakeFetch(
        200,
        {
          stalledMatchProcessing: [],
          stalledNotifications: [],
          unknownDeliveries: [],
          unprojectedMatches: [],
          liveRecoveryBatches: [],
          unacceptedWorkflowStarts: [],
          pages: {
            stalledMatchProcessing: empty,
            stalledNotifications: empty,
            unknownDeliveries: empty,
            unprojectedMatches: empty,
            liveRecoveryBatches: empty,
            unacceptedWorkflowStarts: empty,
          },
        },
        captured,
      ),
    });
    await client.queues({ limit: 5, after: { unknownDeliveries: "a|b" } });
    const url = new URL(captured[0]?.url ?? "");
    expect(url.pathname).toBe("/api/operations/v1/queues");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("cursor.unknownDeliveries")).toBe("a|b");
  });

  test("an error answer becomes a typed error carrying the server's reason", async () => {
    const client = scoutOperationsClient({
      origin: "https://scout-for-lol.com",
      token: "sop_test",
      fetch: fakeFetch(
        403,
        {
          error: "forbidden",
          message: "This credential's operator is not a Scout operator.",
        },
        [],
      ),
    });
    const failure = client.reportDeliveries();
    await expect(failure).rejects.toBeInstanceOf(ScoutOperationsError);
    await expect(failure).rejects.toMatchObject({
      status: 403,
      body: { error: "forbidden" },
    });
  });
});

describe("exit status", () => {
  test.each([
    [{ kind: "executed", outcome: { kind: "delivery-resolved" } }, 0],
    [{ kind: "executed", outcome: { kind: "machine-refused" } }, 3],
    [{ kind: "already_consumed", result: { kind: "delivery-resolved" } }, 0],
    [{ kind: "already_consumed", result: { kind: "target-not-found" } }, 3],
    [{ kind: "intent_expired" }, 1],
  ] as const)("%j exits %i", (partial, code) => {
    const response =
      partial.kind === "executed"
        ? { ...partial, intentId: INTENT_ID, dispatch: null }
        : { ...partial, intentId: INTENT_ID };
    expect(submissionExitCode(response)).toBe(code);
  });

  test("an authorized start whose handoff was unavailable exits 4", () => {
    const base = {
      kind: "executed",
      intentId: INTENT_ID,
      outcome: { kind: "start-authorized", workflow: "reconcile-pipeline" },
    } as const;
    expect(
      submissionExitCode({ ...base, dispatch: { outcome: "unavailable" } }),
    ).toBe(4);
    expect(
      submissionExitCode({ ...base, dispatch: { outcome: "started" } }),
    ).toBe(0);
  });

  test("a dry run prints the request and contacts nothing", async () => {
    const parsed: ParsedScoutOps = await parseScoutOpsArgs([
      "resolve-unknown",
      "--environment",
      "beta",
      "--intent-key",
      INTENT_KEY,
      "--nonce",
      NONCE,
      "--not-delivered",
      "--note",
      "n",
      "--dry-run",
      "--json",
    ]);
    const lines: string[] = [];
    const exit = await runScoutOps(
      parsed,
      () => {
        throw new Error("a dry run must not build a client");
      },
      (line) => lines.push(line),
    );
    expect(exit).toBe(0);
    if (parsed.invocation.action !== "submit") throw new Error("not a submit");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      dryRun: true,
      environment: "beta",
      idempotencyKey: defaultIdempotencyKey(parsed.invocation.request.payload),
    });
    expect(parsed.invocation.request.idempotencyKey).toMatch(
      /^toolkit:[0-9a-f]{40}$/,
    );
  });
});
