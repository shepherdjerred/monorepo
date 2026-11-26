import { expect, test } from "vitest";
import { ACTOR_HEADER, ActorSchema } from "@shepherdjerred/artifacts/contract";
import {
  artifactsBaseUrl,
  createArtifactsClient,
  encodeActorHeader,
} from "#lib/artifacts/client.ts";
import { artifactsActorFrom, workspaceKeyFor } from "#lib/artifacts/actor.ts";
import { ArtifactsCliError, redactTokens } from "#lib/artifacts/errors.ts";
import {
  ACTOR,
  BASE,
  fakeService,
  TrpcFailure,
} from "#test/support/artifacts.ts";

/** Runs a call and returns the failure the CLI would print. */
async function explained(
  client: ReturnType<typeof createArtifactsClient>,
  run: () => Promise<unknown>,
): Promise<ArtifactsCliError> {
  try {
    await run();
  } catch (error) {
    const failure = client.explain(error);
    if (failure instanceof ArtifactsCliError) return failure;
    throw failure;
  }
  throw new Error("expected the call to fail");
}

test("the base URL is validated and normalized", () => {
  expect(artifactsBaseUrl("https://artifacts.test/")).toBe(
    "https://artifacts.test",
  );
  for (const bad of [
    "ftp://artifacts.test",
    "https://user:secret@artifacts.test",
    "https://artifacts.test/?token=1",
    "https://artifacts.test/#frag",
  ])
    expect(() => artifactsBaseUrl(bad)).toThrow(/ARTIFACTS_URL/u);
});

test("the actor travels as base64 JSON in the contract header and is never a token", async () => {
  const service = fakeService({ trpc: { "boards.list": () => [] } });
  await service.client().trpc.boards.list.query();
  const header = service.calls[0]?.headers.get(ACTOR_HEADER) ?? "";
  expect(
    ActorSchema.parse(
      JSON.parse(Buffer.from(header, "base64").toString("utf8")),
    ),
  ).toEqual(ACTOR);
  expect(header).toBe(encodeActorHeader(ACTOR));
  expect(service.calls[0]?.headers.get("authorization")).toBeNull();
});

test("no actor, no header", async () => {
  const service = fakeService({ trpc: { "boards.list": () => [] } });
  await service.client(null).trpc.boards.list.query();
  expect(service.calls[0]?.headers.get(ACTOR_HEADER)).toBeNull();
});

test("a 403 names the operatorLogins fix; the actor header is not echoed", async () => {
  const service = fakeService({
    trpc: {},
    http: () => new Response("forbidden", { status: 403 }),
  });
  const client = createArtifactsClient({
    baseUrl: BASE,
    actor: ACTOR,
    fetch: () => Promise.resolve(new Response("forbidden", { status: 403 })),
  });
  const failure = await explained(client, () =>
    client.trpc.boards.list.query(),
  );
  expect(failure).toMatchObject({ kind: "forbidden", exitCode: 2 });
  const message = failure.message;
  expect(message).toContain("operatorLogins");
  expect(message).not.toContain(encodeActorHeader(ACTOR));
  expect(service.calls).toHaveLength(0);
});

test("an unreachable host says to check the tailnet", async () => {
  const client = createArtifactsClient({
    baseUrl: BASE,
    actor: ACTOR,
    fetch: () => Promise.reject(new TypeError("Unable to connect")),
  });
  const failure = await explained(client, () =>
    client.trpc.boards.list.query(),
  );
  expect(failure).toMatchObject({ kind: "unreachable", transient: true });
  expect(failure.message).toContain("tailscale status");
});

test("a slow service is a timeout, which is transient", async () => {
  const client = createArtifactsClient({
    baseUrl: BASE,
    actor: ACTOR,
    timeoutMs: 20,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error("aborted"));
        });
      }),
  });
  const failure = await explained(client, () =>
    client.trpc.boards.list.query(),
  );
  expect(failure).toMatchObject({ kind: "timeout", transient: true });
});

test("server errors map to kinds that say whether to retry", async () => {
  const service = fakeService({
    trpc: {
      "threads.get": () => {
        throw new TrpcFailure("NOT_FOUND", 404, "Thread not found");
      },
      "boards.create": () => {
        throw new TrpcFailure("CONFLICT", 409, "Board exists");
      },
      "boards.list": () => {
        throw new TrpcFailure("INTERNAL_SERVER_ERROR", 500, "boom");
      },
    },
  });
  const client = service.client();
  const failures = [
    await explained(client, () =>
      client.trpc.threads.get.query({
        threadId: "00000000-0000-4000-8000-000000000000",
      }),
    ),
    await explained(client, () =>
      client.trpc.boards.create.mutate({ slug: "a", title: "A" }),
    ),
    await explained(client, () => client.trpc.boards.list.query()),
  ];
  expect(failures.map((failure) => failure.kind)).toEqual([
    "not-found",
    "conflict",
    "server",
  ]);
  expect(failures[2]?.transient).toBe(true);
});

test("content tokens are redacted from anything printed", () => {
  expect(
    redactTokens(
      "GET https://c.test/_t/AbCdEfGhIjKlMnOpQrStUvWx/app.js failed",
    ),
  ).toBe("GET https://c.test/_t/[redacted]/app.js failed");
  expect(redactTokens("/_t/short/x")).toBe("/_t/short/x");
});

test("the actor adds the workspace key host:worktree and satisfies the contract", () => {
  const context = {
    name: "jerred",
    cwd: "/work/tree/sub",
    hostname: "karpathy",
    worktree: "/work/tree",
    interactive: false,
  };
  expect(workspaceKeyFor(context)).toBe("karpathy:/work/tree");
  expect(
    workspaceKeyFor({
      name: "jerred",
      cwd: "/work/tree/sub",
      hostname: "karpathy",
      interactive: false,
    }),
  ).toBe("karpathy:/work/tree/sub");
  const actor = artifactsActorFrom(
    { CLAUDE_CODE_SESSION_ID: "abc-123", CLAUDECODE: "1" },
    context,
  );
  expect(ActorSchema.safeParse(actor).success).toBe(true);
  expect(actor).toMatchObject({
    key: "claude-code:abc-123",
    kind: "agent",
    workspaceKey: "karpathy:/work/tree",
  });
});

test("an agent with no native session is told how to identify itself", () => {
  expect(() =>
    artifactsActorFrom(
      { CLAUDECODE: "1" },
      { name: "jerred", cwd: "/w", hostname: "h", interactive: false },
    ),
  ).toThrow(/Cannot identify this caller/u);
});
