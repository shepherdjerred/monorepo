import {
  INGEST_CONTRACT,
  type IngestBatch,
  type IngestEvent,
  type OnlinePlayerSummary,
  type WorldBucket,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  DEMO_PLAYERS,
  DEMO_TOWNS,
  buildDemoGameplaySnapshot,
  createDemoBounceEvents,
  deterministicUuid,
  playerUuidFor,
  type DemoPlayerSeed,
} from "./server/demo-profiles.ts";
import type { StormStatsStore } from "./server/store.ts";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./server/time.ts";

const MOBS = [
  "Zombie",
  "Skeleton",
  "Creeper",
  "Wither Skeleton",
  "Blaze",
  "Breeze",
  "Bogged",
  "Warden",
  "Enderman",
  "Piglin Brute",
] as const;

function createDeterministicPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 1_831_565_813) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shouldPlayOnDay(
  player: DemoPlayerSeed,
  daysAgo: number,
  rand: () => number,
): boolean {
  if (daysAgo > player.firstSeenDaysAgo) {
    return false;
  }
  if (daysAgo === player.firstSeenDaysAgo) {
    return true;
  }
  switch (player.archetype) {
    case "regular":
      return rand() < (daysAgo < 21 ? 0.92 : 0.55);
    case "active":
      return rand() < (daysAgo < 21 ? 0.52 : 0.3);
    case "irregular":
      return rand() < (daysAgo < 21 ? 0.18 : 0.12);
    case "inactive":
      return daysAgo >= 24 && rand() < 0.22;
  }
}

type DaySessionContext = {
  readonly nowMs: number;
  readonly dayBaseMs: number;
  readonly daysAgo: number;
  readonly rand: () => number;
  readonly nextEventId: () => string;
  readonly nextSessionId: () => string;
};

function sliceConfigForPlayer(
  player: DemoPlayerSeed,
  rand: () => number,
): { readonly sliceCount: number; readonly sliceConnectedMs: number } {
  if (player.index === 28) {
    return { sliceCount: 1, sliceConnectedMs: 5 * MINUTE_MS };
  }
  if (player.archetype === "regular") {
    return {
      sliceCount: 4 + Math.floor(rand() * 3),
      sliceConnectedMs: (42 + Math.floor(rand() * 22)) * MINUTE_MS,
    };
  }
  const sliceCount =
    player.archetype === "active"
      ? 2 + Math.floor(rand() * 2)
      : 1 + Math.floor(rand() * 2);
  return {
    sliceCount,
    sliceConnectedMs: (20 + Math.floor(rand() * 24)) * MINUTE_MS,
  };
}

function generateSliceMobCombat(
  player: DemoPlayerSeed,
  sessionId: string,
  timing: {
    readonly cursorMs: number;
    readonly durMs: number;
    readonly world: WorldBucket;
  },
  ctx: DaySessionContext,
): IngestEvent[] {
  const out: IngestEvent[] = [];
  const playerUuid = playerUuidFor(player.index);
  if (ctx.rand() < 0.48) {
    const mob = MOBS[Math.floor(ctx.rand() * MOBS.length)] ?? "Zombie";
    out.push({
      type: "combat_event",
      eventId: ctx.nextEventId(),
      occurredAt: new Date(
        timing.cursorMs + Math.floor(timing.durMs / 2),
      ).toISOString(),
      sessionId,
      combatKind: "pve_kill",
      killerUuid: playerUuid,
      killerName: player.name,
      victimUuid: null,
      victimName: null,
      mobType: mob,
      weapon: player.favWeapon,
      world: timing.world,
    });
  }
  if (ctx.rand() < 0.08) {
    const mob = MOBS[Math.floor(ctx.rand() * MOBS.length)] ?? "Creeper";
    out.push({
      type: "combat_event",
      eventId: ctx.nextEventId(),
      occurredAt: new Date(
        timing.cursorMs + Math.floor(timing.durMs * 0.7),
      ).toISOString(),
      sessionId,
      combatKind: ctx.rand() < 0.7 ? "pve_death" : "env_death",
      killerUuid: null,
      killerName: null,
      victimUuid: playerUuid,
      victimName: player.name,
      mobType: mob,
      weapon: mob === "Warden" ? "Sonic Boom" : "Melee",
      world: timing.world,
    });
  }
  return out;
}

function generatePlayerSessionEvents(
  player: DemoPlayerSeed,
  ctx: DaySessionContext,
): IngestEvent[] {
  const events: IngestEvent[] = [];
  const firstSeenIso = new Date(
    ctx.nowMs - player.firstSeenDaysAgo * DAY_MS - 3 * HOUR_MS,
  ).toISOString();
  const hourOffset = 1 + Math.floor(ctx.rand() * 20);
  const sessionStartMs = Math.min(
    ctx.nowMs - 45 * MINUTE_MS,
    ctx.dayBaseMs -
      hourOffset * HOUR_MS +
      Math.floor(ctx.rand() * 40) * MINUTE_MS,
  );
  const sessionId = ctx.nextSessionId();
  const playerUuid = playerUuidFor(player.index);
  const { sliceCount, sliceConnectedMs } = sliceConfigForPlayer(
    player,
    ctx.rand,
  );

  events.push({
    type: "session_started",
    eventId: ctx.nextEventId(),
    occurredAt: new Date(sessionStartMs).toISOString(),
    sessionId,
    playerUuid,
    playerName: player.name,
    firstSeenAt: firstSeenIso,
    platform: player.platform,
    clientVersion: player.clientVersion,
    clientBrand: player.clientBrand,
    joinAddress: player.joinAddress,
    countryCode: player.countryCode,
    countryName: player.countryName,
  });

  let cursorMs = sessionStartMs;
  let totalConnected = 0;
  let totalActive = 0;
  let pingMin = 99_999;
  let pingMax = 0;
  let pingSum = 0;

  for (let s = 0; s < sliceCount; s += 1) {
    const durMs = Math.max(
      MINUTE_MS,
      Math.min(ctx.nowMs, cursorMs + sliceConnectedMs) - cursorMs,
    );
    const activeMs =
      player.index === 28
        ? 4 * MINUTE_MS
        : Math.round(durMs * (0.76 + ctx.rand() * 0.22));
    const ping = Math.max(
      12,
      player.basePingMs + Math.round((ctx.rand() - 0.5) * 18),
    );
    pingMin = Math.min(pingMin, ping);
    pingMax = Math.max(pingMax, ping);
    pingSum += ping;
    totalConnected += durMs;
    totalActive += activeMs;

    const world = s === 0 || ctx.rand() < 0.7 ? player.favWorld : "frontier";
    const mode = s === 0 || ctx.rand() < 0.75 ? player.favMode : "survival";

    events.push({
      type: "session_interval",
      eventId: ctx.nextEventId(),
      occurredAt: new Date(cursorMs).toISOString(),
      intervalEnd: new Date(cursorMs + durMs).toISOString(),
      sessionId,
      playerUuid,
      playerName: player.name,
      world,
      mode,
      connectedMs: durMs,
      activeMs,
      pingMs: ping,
    });
    events.push(
      ...generateSliceMobCombat(
        player,
        sessionId,
        { cursorMs, durMs, world },
        ctx,
      ),
    );
    cursorMs += durMs;
  }

  if (!(ctx.daysAgo === 0 && player.onlineNow)) {
    events.push({
      type: "session_ended",
      eventId: ctx.nextEventId(),
      occurredAt: new Date(cursorMs).toISOString(),
      sessionId,
      playerUuid,
      playerName: player.name,
      startedAt: new Date(sessionStartMs).toISOString(),
      connectedMs: totalConnected,
      activeMs: totalActive,
      endReason: "disconnect",
      pingMinMs: pingMin,
      pingAvgMs: Math.round(pingSum / sliceCount),
      pingMaxMs: pingMax,
    });
  }
  return events;
}

function flushEventChunks(
  store: StormStatsStore,
  events: readonly IngestEvent[],
  sentAt: string,
  nextBatchId: () => string,
): number {
  const maxChunk = INGEST_CONTRACT.maxEventsPerBatch;
  let batches = 0;
  for (let i = 0; i < events.length; i += maxChunk) {
    const batch: IngestBatch = {
      schemaVersion: 2,
      batchId: nextBatchId(),
      serverName: "The Storm",
      sentAt,
      events: events.slice(i, i + maxChunk),
      playerSnapshots: [],
      serverSnapshot: null,
    };
    store.ingestBatch(batch);
    batches += 1;
  }
  return batches;
}

/**
 * Populates ~28 realistic players over 90 days on "The Storm" through
 * `store.ingestBatch(...)` so local dev and screenshots exercise the exact
 * wire ingestion and SQLite rollup pipeline.
 */
export function seedDemoData(
  store: StormStatsStore,
  now: Date = new Date(),
): { readonly playersSeeded: number; readonly batchesIngested: number } {
  const rand = createDeterministicPrng(1_459_888_166);
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  let eventSeq = 1;
  let sessionSeq = 1;
  let batchSeq = 1;
  const nextEventId = () => deterministicUuid("e0000001", eventSeq++);
  const nextSessionId = () => deterministicUuid("5e550001", sessionSeq++);
  const nextBatchId = () => deterministicUuid("ba7c0001", batchSeq++);

  const allEvents: IngestEvent[] = [];
  let batchesIngested = 0;

  for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 1) {
    const dayBaseMs = nowMs - daysAgo * DAY_MS;
    const activeToday = DEMO_PLAYERS.filter((p) =>
      shouldPlayOnDay(p, daysAgo, rand),
    );
    const ctx: DaySessionContext = {
      nowMs,
      dayBaseMs,
      daysAgo,
      rand,
      nextEventId,
      nextSessionId,
    };

    for (const player of activeToday) {
      allEvents.push(...generatePlayerSessionEvents(player, ctx));
    }

    const killer = activeToday[Math.floor(rand() * activeToday.length)];
    const victim = activeToday.find((p) => p.index !== killer?.index);
    if (killer !== undefined && victim !== undefined && rand() < 0.65) {
      allEvents.push({
        type: "combat_event",
        eventId: nextEventId(),
        occurredAt: new Date(dayBaseMs - 2 * HOUR_MS).toISOString(),
        sessionId: null,
        combatKind: "pvp",
        killerUuid: playerUuidFor(killer.index),
        killerName: killer.name,
        victimUuid: playerUuidFor(victim.index),
        victimName: victim.name,
        mobType: null,
        weapon: killer.favWeapon,
        world: killer.favMode === "rwf" ? "rwf" : killer.favWorld,
      });
    }

    if (daysAgo > 0 && activeToday.length > 0) {
      const snapTime = new Date(dayBaseMs - HOUR_MS).toISOString();
      const onlinePlayers: OnlinePlayerSummary[] = activeToday
        .slice(0, Math.min(activeToday.length, 16))
        .map((p) => ({
          uuid: playerUuidFor(p.index),
          name: p.name,
          mode: p.favMode,
          world: p.favWorld,
          afk: false,
          pingMs: p.basePingMs,
          sessionStartedAt: new Date(dayBaseMs - 2 * HOUR_MS).toISOString(),
        }));
      store.ingestBatch({
        schemaVersion: 2,
        batchId: nextBatchId(),
        serverName: "The Storm",
        sentAt: snapTime,
        events: [],
        playerSnapshots: [],
        serverSnapshot: {
          capturedAt: snapTime,
          onlinePlayers,
          maxPlayers: 64,
          townsCount: DEMO_TOWNS.length,
          towns: [...DEMO_TOWNS],
        },
      });
      batchesIngested += 1;
    }
  }

  allEvents.push(...createDemoBounceEvents(nowMs, nextEventId, rand));
  batchesIngested += flushEventChunks(store, allEvents, nowIso, nextBatchId);

  const onlineNowPlayers: OnlinePlayerSummary[] = DEMO_PLAYERS.filter(
    (p) => p.onlineNow,
  ).map((p, idx) => ({
    uuid: playerUuidFor(p.index),
    name: p.name,
    mode: p.favMode,
    world: p.favWorld,
    afk: idx === 4,
    pingMs: p.basePingMs,
    sessionStartedAt: new Date(
      nowMs - (35 + idx * 14) * MINUTE_MS,
    ).toISOString(),
  }));

  store.ingestBatch({
    schemaVersion: 2,
    batchId: nextBatchId(),
    serverName: "The Storm",
    sentAt: nowIso,
    events: [],
    playerSnapshots: DEMO_PLAYERS.map((p) =>
      buildDemoGameplaySnapshot(p, nowIso, rand),
    ),
    serverSnapshot: {
      capturedAt: nowIso,
      onlinePlayers: onlineNowPlayers,
      maxPlayers: 64,
      townsCount: DEMO_TOWNS.length,
      towns: [...DEMO_TOWNS],
    },
  });
  batchesIngested += 1;

  return { playersSeeded: DEMO_PLAYERS.length, batchesIngested };
}
