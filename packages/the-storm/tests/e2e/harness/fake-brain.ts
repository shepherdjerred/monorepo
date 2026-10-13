import { z } from "zod";
import { rwfTestSettings } from "./rwf-settings.ts";

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

type BrainState = {
  mode: FakeBrainMode;
  analytics: unknown[];
  /** Players the Flipt double answers `the-storm-rwf-enabled: false` for. */
  rwfDenied: Set<string>;
  /** The Red Warfare match features the Flipt double answers `true` for. */
  rwfFeatures: Set<RwfFeature>;
  /** Players the double answers `the-storm-rwf-kits-enabled: true` for. */
  rwfKits: Set<string>;
  /** Players the double answers `the-storm-rwf-killstreaks-enabled: true` for. */
  rwfKillstreaks: Set<string>;
};

/** The managed Red Warfare match feature flags, server-wide. */
export const rwfFeatureFlags = [
  "the-storm-rwf-match-flow-enabled",
  "the-storm-rwf-carry-over-enabled",
  "the-storm-rwf-death-feed-enabled",
  "the-storm-rwf-team-chat-enabled",
  "the-storm-rwf-spectator-tools-enabled",
  "the-storm-rwf-bomb-effects-enabled",
  "the-storm-rwf-stats-enabled",
] as const;

export type RwfFeature = (typeof rwfFeatureFlags)[number];

/** The rwf feature flags are one server-wide entity, evaluated in the map world. */
const RwfFeatureFlagSchema = z.strictObject({
  namespace_key: z.literal("the-storm"),
  flag_key: z.enum(rwfFeatureFlags),
  entity_id: z.literal("the-storm-rwf-features"),
  context: z.strictObject({ world: z.literal(rwfTestSettings.world) }),
});

/** The kit list and killstreak flags are per player, evaluated in the map world. */
const RwfPlayerFlagSchema = z.strictObject({
  namespace_key: z.literal("the-storm"),
  flag_key: z.enum([
    "the-storm-rwf-kits-enabled",
    "the-storm-rwf-killstreaks-enabled",
  ]),
  entity_id: z.uuid(),
  context: z.strictObject({ world: z.literal(rwfTestSettings.world) }),
});

// Test-only control hook (no auth): the kit suite opens the full kit list, the
// shop and the killstreaks for its players; the server reads them as they join.
async function controlRwfKits(
  request: Request,
  state: BrainState,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("not found\n", { status: 404 });
  }
  const seen = z
    .strictObject({
      kits: z.array(z.uuid()),
      killstreaks: z.array(z.uuid()),
    })
    .safeParse(await request.json().catch(() => null));
  if (!seen.success) {
    return new Response("invalid request\n", { status: 400 });
  }
  state.rwfKits = new Set(seen.data.kits);
  state.rwfKillstreaks = new Set(seen.data.killstreaks);
  return Response.json(seen.data);
}

/**
 * Opens the full kit list and shop for exactly `kits`, and the killstreaks for
 * exactly `killstreaks` (player UUIDs), through the Flipt double's control hook.
 */
export async function setRwfKits(
  port: number,
  kits: string[],
  killstreaks: string[] = kits,
): Promise<void> {
  const host = Bun.env["STORM_E2E_BRAIN_HOST"] ?? "127.0.0.1";
  const response = await fetch(
    `http://${host}:${port.toString()}/v1/__control/rwf-kits`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kits, killstreaks }),
    },
  );
  if (!response.ok) {
    throw new Error(`rwf kits control failed: ${response.status.toString()}`);
  }
}

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

// Test-only control hook (no auth): the rwf suite closes the join flag for
// chosen players to prove the refusal. Never present on the real service.
async function controlRwf(
  request: Request,
  state: BrainState,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("not found\n", { status: 404 });
  }
  const seen = z
    .strictObject({ denied: z.array(z.uuid()) })
    .safeParse(await request.json().catch(() => null));
  if (!seen.success) {
    return new Response("invalid request\n", { status: 400 });
  }
  state.rwfDenied = new Set(seen.data.denied);
  return Response.json({ denied: [...state.rwfDenied] });
}

// Test-only control hook (no auth): the rwf suite switches match features on
// to prove them; the server reads them as each lobby opens.
async function controlRwfFeatures(
  request: Request,
  state: BrainState,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("not found\n", { status: 404 });
  }
  const seen = z
    .strictObject({ enabled: z.array(z.enum(rwfFeatureFlags)) })
    .safeParse(await request.json().catch(() => null));
  if (!seen.success) {
    return new Response("invalid request\n", { status: 400 });
  }
  state.rwfFeatures = new Set(seen.data.enabled);
  return Response.json({ enabled: [...state.rwfFeatures] });
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

/**
 * Closes `the-storm-rwf-enabled` for exactly `denied` (player UUIDs) through
 * the Flipt double's test-only control hook; an empty list opens it again.
 */
export async function setRwfDenied(
  port: number,
  denied: string[],
): Promise<void> {
  const host = Bun.env["STORM_E2E_BRAIN_HOST"] ?? "127.0.0.1";
  const response = await fetch(
    `http://${host}:${port.toString()}/v1/__control/rwf`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ denied }),
    },
  );
  if (!response.ok) {
    throw new Error(`rwf flag control failed: ${response.status.toString()}`);
  }
}

/**
 * Switches on exactly `enabled` of the Red Warfare match feature flags through
 * the Flipt double's test-only control hook; the rest answer off.
 */
export async function setRwfFeatures(
  port: number,
  enabled: RwfFeature[],
): Promise<void> {
  const host = Bun.env["STORM_E2E_BRAIN_HOST"] ?? "127.0.0.1";
  const response = await fetch(
    `http://${host}:${port.toString()}/v1/__control/rwf-features`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `rwf feature control failed: ${response.status.toString()}`,
    );
  }
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

function expansionEvaluation(
  body: unknown,
  request: Request,
): Response | undefined {
  const expansion = z
    .strictObject({
      namespace_key: z.literal("the-storm"),
      flag_key: z.enum([
        "the-storm-staff-tools-enabled",
        "the-storm-identity-enabled",
        "the-storm-letters-enabled",
        "the-storm-ip-enforcement-enabled",
        "the-storm-analytics-enabled",
      ]),
      entity_id: z.uuid(),
      context: z.strictObject({}),
    })
    .safeParse(body);
  return expansion.success &&
    request.headers.get("x-flipt-environment") === "prod"
    ? Response.json({
        enabled: expansion.data.flag_key !== "the-storm-ip-enforcement-enabled",
      })
    : undefined;
}

/** Bot chat is one server-wide flag, evaluated with the rwf world as context. */
const BotChatFlagSchema = z.strictObject({
  namespace_key: z.literal("the-storm"),
  flag_key: z.literal("the-storm-rwfbots-chat-enabled"),
  entity_id: z.literal("the-storm-rwfbots-chat"),
  context: z.strictObject({ world: z.literal(rwfTestSettings.world) }),
});

/** Ordinary learned gameplay stays off in the authored native regression lane. */
const BotLearningFlagSchema = z
  .strictObject({
    namespace_key: z.literal("the-storm"),
    flag_key: z.literal("the-storm-rwfbots-learning-enabled"),
    entity_id: z.uuid(),
    context: z.strictObject({
      match: z.uuid(),
      map: z.string().min(1),
      world: z.literal(rwfTestSettings.world),
    }),
  })
  .refine((value) => value.entity_id === value.context.match);

/**
 * The Flipt double: companions stay off; bot chat, the crier, merchant and rwf
 * gates open, except rwf for the players the suite denied.
 */
async function evaluateFlag(
  request: Request,
  state: BrainState,
): Promise<Response> {
  const body: unknown = await request.json();
  const expanded = expansionEvaluation(body, request);
  if (expanded !== undefined) return expanded;
  const prod = request.headers.get("x-flipt-environment") === "prod";
  const companion = z
    .strictObject({
      namespace_key: z.literal("the-storm"),
      flag_key: z.literal("the-storm-companions-enabled"),
      entity_id: z.literal("the-storm-companions"),
      context: z.strictObject({}),
    })
    .safeParse(body);
  if (prod && companion.success) {
    return Response.json({ enabled: false });
  }
  if (prod && BotChatFlagSchema.safeParse(body).success) {
    return Response.json({ enabled: true });
  }
  if (prod && BotLearningFlagSchema.safeParse(body).success) {
    return Response.json({ enabled: false });
  }
  const playerFlag = RwfPlayerFlagSchema.safeParse(body);
  if (prod && playerFlag.success) {
    const open =
      playerFlag.data.flag_key === "the-storm-rwf-kits-enabled"
        ? state.rwfKits
        : state.rwfKillstreaks;
    return Response.json({ enabled: open.has(playerFlag.data.entity_id) });
  }
  const feature = RwfFeatureFlagSchema.safeParse(body);
  if (prod && feature.success) {
    return Response.json({
      enabled: state.rwfFeatures.has(feature.data.flag_key),
    });
  }
  const evaluated = z
    .object({
      namespace_key: z.literal("the-storm"),
      flag_key: z.enum([
        "the-storm-crier-enabled",
        "the-storm-merchant-enabled",
        "the-storm-rwf-enabled",
        "the-storm-survival-enabled",
      ]),
      entity_id: z.uuid(),
      // The crier and merchant evaluate in the main world; rwf in its own.
      context: z
        .object({ world: z.enum(["world", rwfTestSettings.world]) })
        .strict(),
    })
    .strict()
    .safeParse(body);
  if (!prod || !evaluated.success) {
    return new Response("invalid evaluation", { status: 400 });
  }
  const denied =
    evaluated.data.flag_key === "the-storm-rwf-enabled" &&
    state.rwfDenied.has(evaluated.data.entity_id);
  return Response.json({ enabled: !denied });
}

/** The test-only control hooks, by path. */
const controls: Partial<
  Record<string, (request: Request, state: BrainState) => Promise<Response>>
> = {
  "/v1/__control": control,
  "/v1/__control/rwf": controlRwf,
  "/v1/__control/rwf-features": controlRwfFeatures,
  "/v1/__control/rwf-kits": controlRwfKits,
};

export function startFakeBrain(token: string, port = 0): FakeBrain {
  const state: BrainState = {
    mode: "ok",
    rwfDenied: new Set(),
    rwfFeatures: new Set(),
    rwfKits: new Set(),
    rwfKillstreaks: new Set(),
    analytics: [],
  };
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/batch/" && request.method === "POST") {
        const batch = z
          .strictObject({
            api_key: z.literal("phc_test"),
            batch: z.array(z.record(z.string(), z.unknown())),
          })
          .parse(await request.json());
        state.analytics.push(...batch.batch);
        return Response.json({ status: 1 });
      }
      if (
        url.pathname === "/v1/__control/analytics" &&
        request.method === "GET"
      ) {
        return Response.json(state.analytics);
      }
      if (
        url.pathname === "/evaluate/v1/boolean" &&
        request.method === "POST"
      ) {
        return evaluateFlag(request, state);
      }
      const controlHook = controls[url.pathname];
      if (controlHook !== undefined) {
        return controlHook(request, state);
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
