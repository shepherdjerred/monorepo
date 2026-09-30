import { z } from "zod";

/**
 * The storm-brain double the server container talks to. It answers both flows
 * with uncertain verdicts (the stub script, over HTTP), so the agent records
 * the same shadow rows it would against a brain that knows nothing yet.
 *
 * It is a strict double, not a lenient one: wrong tokens get 401, requests
 * whose top-level keys differ from the v1 contract get 400, and anything else
 * gets 404. The key sets pin `storm-brain/src/schemas.ts`; a contract change
 * updates both. Full value validation stays with the real service.
 */

const ClassifyKeys = ["lines", "player"] as const;
const TriageKeys = [
  "comments",
  "reporterBanned",
  "reporterHistory",
  "reporterRecentChat",
  "ticket",
] as const;

const BodySchema = z.record(z.string(), z.unknown());

function keySet(value: unknown): string[] {
  return Object.keys(BodySchema.parse(value)).toSorted();
}

function sameKeys(value: unknown, expected: readonly string[]): boolean {
  const actual = keySet(value);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected.toSorted()[index])
  );
}

export type FakeBrain = {
  port: number;
  stop: () => Promise<void>;
};

export type FakeBrainMode = "ok" | "down";

type BrainState = { mode: FakeBrainMode };

// Test-only control hook (no auth): the specs fail and heal the brain to
// prove the sweep redrives. Never present on the real service.
async function control(request: Request, state: BrainState): Promise<Response> {
  if (request.method === "GET") {
    return Response.json({ mode: state.mode });
  }
  if (request.method !== "POST") {
    return new Response("not found\n", { status: 404 });
  }
  const seen = z
    .object({ mode: z.enum(["ok", "down"]) })
    .safeParse(await request.json().catch(() => null));
  if (!seen.success) {
    return new Response("invalid request\n", { status: 400 });
  }
  state.mode = seen.data.mode;
  return Response.json({ mode: state.mode });
}

function classify(body: unknown): Response {
  if (!sameKeys(body, ClassifyKeys)) {
    return new Response("invalid request\n", { status: 400 });
  }
  return Response.json({
    offense: null,
    confidence: 0,
    label: "uncertain",
    reasoning: "the fake brain knows nothing",
    model: "fake-brain",
    costMicros: 0,
  });
}

function triage(body: unknown): Response {
  if (!sameKeys(body, TriageKeys)) {
    return new Response("invalid request\n", { status: 400 });
  }
  return Response.json({
    priorityId: "normal",
    confidence: 0,
    duplicates: [],
    evidence: "the fake brain knows nothing",
    draftReply: "looking into it",
    resolve: false,
    resolutionNote: "",
    model: "fake-brain",
    costMicros: 0,
  });
}

/** Fails or heals the fake brain through its test-only control hook. */
export async function setBrainMode(
  port: number,
  mode: FakeBrainMode,
): Promise<void> {
  const host = Bun.env["STORM_E2E_BRAIN_HOST"] ?? "127.0.0.1";
  const response = await fetch(
    `http://${host}:${port.toString()}/v1/__control`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    },
  );
  if (!response.ok) {
    throw new Error(`brain control failed: ${response.status.toString()}`);
  }
}

export function startFakeBrain(token: string, port = 0): FakeBrain {
  const state: BrainState = { mode: "ok" };
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/__control") {
        return control(request, state);
      }
      if (request.method !== "POST" || !url.pathname.startsWith("/v1/")) {
        return new Response("not found\n", { status: 404 });
      }
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("unauthorized\n", { status: 401 });
      }
      if (
        request.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json") !== true
      ) {
        return new Response("application/json required\n", { status: 415 });
      }
      if (state.mode === "down") {
        return new Response("brain error\n", { status: 500 });
      }
      let body: unknown;
      try {
        body = BodySchema.parse(await request.json());
      } catch {
        return new Response("invalid request\n", { status: 400 });
      }
      switch (url.pathname) {
        case "/v1/classify": {
          return classify(body);
        }
        case "/v1/triage": {
          return triage(body);
        }
        default: {
          return new Response("not found\n", { status: 404 });
        }
      }
    },
  });
  if (server.port === undefined) {
    throw new Error("fake brain did not bind a port");
  }
  return { port: server.port, stop: async () => server.stop() };
}

if (import.meta.main) {
  const env = z
    .object({
      STORM_E2E_BRAIN_TOKEN: z.string().min(1),
      STORM_E2E_BRAIN_PORT: z.coerce.number().int().positive(),
    })
    .parse(Bun.env);
  const brain = startFakeBrain(
    env.STORM_E2E_BRAIN_TOKEN,
    env.STORM_E2E_BRAIN_PORT,
  );
  console.warn(`Fake brain listening on port ${brain.port.toString()}`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await brain.stop();
}
