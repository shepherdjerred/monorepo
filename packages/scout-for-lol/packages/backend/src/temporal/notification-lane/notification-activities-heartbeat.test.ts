import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  type CompletedMatch,
} from "@scout-for-lol/data";
import { svgToPng } from "@scout-for-lol/report";
import {
  createRenderWorkerClient,
  resolveRenderWorkerUrl,
} from "@scout-for-lol/report/html/render-worker-client.ts";
import { NOTIFICATION_PRE_SEND_BUDGET_MS } from "@scout-for-lol/temporal/activity-contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#src/database/index.ts";
import type * as NotificationArtifactModule from "#src/temporal/notification/notification-artifact.ts";
import {
  attemptRef,
  intentRecord,
} from "#src/temporal/notification-lane/notification-delivery.test-fixtures.ts";

/**
 * Regression suite for AI-524 (`deliverNotification` heartbeats starving
 * behind synchronous report rendering on the shared `activity-worker` JS loop).
 *
 * Proves three invariants:
 * 1. Concurrent full-size 4760x3500 Satori + `@resvg/resvg-js` report renders
 *    execute off the main JS event loop via the dedicated Bun `Worker`,
 *    keeping main-thread event-loop stall well under 200ms even during a
 *    7-report burst while `deliverNotification` heartbeats fire on schedule.
 * 2. `deliverNotification` emits `preparing-notification-v2` immediately at
 *    activity entry, transitions heartbeat details to `sending-to-discord-v2`
 *    right before `deliverToTarget` (never on pre-send failure/suppression),
 *    and sustains `sending-to-discord-v2` across recurring interval beats.
 * 3. A cold `notification-delivery` module load that outruns the pre-send
 *    budget resolves as a definite retryable `failed` outcome rather than
 *    timing out at 10s into `unknown-delivery`.
 */

const heartbeats: unknown[] = [];
let heartbeatTimeoutMs: number | undefined = 3000;

const stubs = vi.hoisted(() => ({
  requireIntentRecord: vi.fn(),
  resolveNotificationGate: vi.fn(),
  readAttestedPostmatchArtifact: vi.fn(),
  readAttestedPrematchArtifact: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  send: vi.fn(),
  sendDM: vi.fn(),
  matchNotificationPreferenceSuppression: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      info: {
        attempt: 1,
        heartbeatTimeoutMs,
        taskQueue: "scout-beta-realtime",
      },
      heartbeat: (details: unknown) => {
        heartbeats.push(details);
      },
    }),
  },
}));

vi.mock("#src/temporal/notification/account-preference.ts", () => ({
  matchNotificationPreferenceSuppression:
    stubs.matchNotificationPreferenceSuppression,
}));
vi.mock("#src/temporal/notification-lane/notification-reads.ts", () => ({
  requireIntentRecord: stubs.requireIntentRecord,
}));
vi.mock("#src/temporal/notification/notification-policy.ts", () => ({
  resolveNotificationGate: stubs.resolveNotificationGate,
}));
vi.mock("#src/temporal/notification/notification-artifact.ts", async () => {
  const actual = await vi.importActual<typeof NotificationArtifactModule>(
    "#src/temporal/notification/notification-artifact.ts",
  );
  return Object.assign({}, actual, {
    readAttestedPostmatchArtifact: stubs.readAttestedPostmatchArtifact,
    readAttestedPrematchArtifact: stubs.readAttestedPrematchArtifact,
  });
});
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/discord/utils/dm.ts", () => ({ sendDM: stubs.sendDM }));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/league/discord/channel.ts", async () => {
  const fixtures =
    await import("#src/temporal/notification-lane/notification-delivery.test-fixtures.ts");
  return await fixtures.channelModuleWithSend(stubs.send);
});

const {
  createScoutNotificationActivities,
  preloadNotificationDelivery,
  setNotificationDeliveryLoaderForTest,
} = await import("#src/temporal/notification-lane/notification-activities.ts");

const ARTIFACT_BYTES = new Uint8Array([137, 80, 78, 71, 7, 7, 7]);

function attestedReport(): unknown {
  return {
    image: ARTIFACT_BYTES,
    evidence: {
      artifact: "report",
      riotMatchId: "NA1_9301",
      image: {
        objectKey: "games/2026/09/16/NA1_9301/report.png",
        digest: "f".repeat(64),
        bytes: ARTIFACT_BYTES.byteLength,
        contentType: "image/png",
      },
      content: "jerred finished a solo game",
      components: "match-link",
    },
  };
}

function sampleParticipant(name: string, championName: string) {
  return {
    riotIdGameName: name,
    championName,
    kills: 8,
    deaths: 4,
    assists: 9,
    items: [1031, 3047, 3071, 3156, 6631, 0, 3364],
    spells: [4, 12],
    runes: [
      { id: 8128, name: "Dark Harvest", description: "Adaptive damage" },
      { id: 8126, name: "Cheap Shot", description: "Bonus true damage" },
    ],
    lane: "top" as const,
    creepScore: 195,
    visionScore: 24,
    damage: 24_500,
    gold: 13_400,
    level: 16,
  };
}

function sampleCompletedMatch(): CompletedMatch {
  const blue = [
    sampleParticipant("Alpha", "Aatrox"),
    sampleParticipant("Bravo", "Nocturne"),
    sampleParticipant("Charlie", "Orianna"),
    sampleParticipant("Delta", "Jinx"),
    sampleParticipant("Echo", "Thresh"),
  ];
  const red = [
    sampleParticipant("Foxtrot", "Renekton"),
    sampleParticipant("Golf", "LeeSin"),
    sampleParticipant("Hotel", "Ahri"),
    sampleParticipant("India", "KaiSa"),
    sampleParticipant("Juliet", "Nautilus"),
  ];
  const hero = blue[0];
  const opponent = red[0];
  if (hero === undefined || opponent === undefined) {
    throw new Error("Expected five-player teams");
  }
  return {
    queueType: "draft pick",
    players: [
      {
        playerConfig: {
          alias: "Alpha",
          league: {
            leagueAccount: {
              puuid: LeaguePuuidSchema.parse(
                "XtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDz9biieJ5ZRD049AUCBjLjyBeeezTaw",
              ),
              region: "AMERICA_NORTH",
            },
          },
          discordAccount: {
            id: DiscordAccountIdSchema.parse("12345678901234567"),
          },
        },
        wins: 12,
        losses: 8,
        champion: hero,
        outcome: "Victory",
        team: "blue",
        lane: "top",
        laneOpponent: opponent,
      },
    ],
    durationInSeconds: 1850,
    teams: { blue, red },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  heartbeats.length = 0;
  heartbeatTimeoutMs = 3000;
  setNotificationDeliveryLoaderForTest();
  vi.spyOn(prisma.notificationPresentation, "findUnique").mockResolvedValue(
    null,
  );
  stubs.matchNotificationPreferenceSuppression.mockResolvedValue(undefined);
  stubs.requireIntentRecord.mockResolvedValue(intentRecord("channel"));
  stubs.resolveNotificationGate.mockResolvedValue({
    kind: "postmatch",
    target: "channel",
    policy: "normal",
    decision: "permitted",
  });
  stubs.readAttestedPostmatchArtifact.mockResolvedValue(attestedReport());
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: undefined });
  stubs.send.mockResolvedValue({ id: "100000000000000777" });
});

afterEach(() => {
  vi.useRealTimers();
  setNotificationDeliveryLoaderForTest();
});

describe("deliverNotification activity heartbeat progression", () => {
  test("advances heartbeat details from preparing-notification-v2 to sending-to-discord-v2 and sustains them", async () => {
    await preloadNotificationDelivery();
    vi.useFakeTimers();
    heartbeatTimeoutMs = 10_000;

    let releaseSend: (() => void) | undefined;
    stubs.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSend = () => {
            resolve({ id: "100000000000000777" });
          };
        }),
    );

    const activities = createScoutNotificationActivities();
    const ref = attemptRef();
    const deliveryPromise = activities.deliverNotification(ref);

    await vi.waitFor(() => {
      expect(stubs.send).toHaveBeenCalledTimes(1);
    });

    expect(heartbeats[0]).toEqual({
      intentKey: ref.intentKey,
      attemptNonce: ref.attemptNonce,
      phase: "preparing-notification-v2",
    });
    expect(heartbeats[1]).toEqual({
      intentKey: ref.intentKey,
      attemptNonce: ref.attemptNonce,
      phase: "sending-to-discord-v2",
    });

    await vi.advanceTimersByTimeAsync(7000);
    expect(heartbeats.length).toBeGreaterThanOrEqual(4);
    for (const beat of heartbeats.slice(1)) {
      expect(beat).toEqual({
        intentKey: ref.intentKey,
        attemptNonce: ref.attemptNonce,
        phase: "sending-to-discord-v2",
      });
    }

    releaseSend?.();
    await expect(deliveryPromise).resolves.toMatchObject({
      outcome: "delivered",
    });
  });

  test("never emits sending-to-discord-v2 when pre-send fails before contacting Discord", async () => {
    await preloadNotificationDelivery();
    stubs.readAttestedPostmatchArtifact.mockRejectedValue(
      new Error("s3 read failed"),
    );

    const activities = createScoutNotificationActivities();
    const ref = attemptRef();
    const result = await activities.deliverNotification(ref);

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "retryable", reason: "service-unavailable" },
    });
    expect(heartbeats).toEqual([
      {
        intentKey: ref.intentKey,
        attemptNonce: ref.attemptNonce,
        phase: "preparing-notification-v2",
      },
    ]);
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test("bounds a cold notification-delivery import under withPreSendBudget instead of hanging to unknown-delivery", async () => {
    vi.useFakeTimers();
    setNotificationDeliveryLoaderForTest(
      () =>
        new Promise(() => {
          // Simulated cold module graph hang.
        }),
    );

    const activities = createScoutNotificationActivities();
    const ref = attemptRef();
    const pending = activities.deliverNotification(ref);

    await vi.advanceTimersByTimeAsync(NOTIFICATION_PRE_SEND_BUDGET_MS);

    await expect(pending).resolves.toEqual({
      outcome: "failed",
      failure: { classification: "retryable", reason: "service-unavailable" },
    });
    expect(heartbeats[0]).toEqual({
      intentKey: ref.intentKey,
      attemptNonce: ref.attemptNonce,
      phase: "preparing-notification-v2",
    });
  });
});

describe("worker-offloaded report rendering under burst load", () => {
  test("resolves worker URLs cleanly for both source (.ts/.tsx) and bundled (.js) runtimes", () => {
    expect(
      resolveRenderWorkerUrl(
        "file:///app/packages/report/src/html/render-worker-client.ts",
      ),
    ).toBe("file:///app/packages/report/src/html/render-worker.ts");
    expect(
      resolveRenderWorkerUrl("file:///app/packages/report/src/html/index.tsx"),
    ).toBe("file:///app/packages/report/src/html/render-worker.ts");
    expect(
      resolveRenderWorkerUrl("file:///app/packages/backend/dist/index.js"),
    ).toBe("file:///app/packages/backend/dist/render-worker.js");
  });

  test("renders identically through bundled dist/render-worker.js when built", async () => {
    const bundledWorkerUrl = new URL(
      "../../../../dist/render-worker.js",
      import.meta.url,
    );
    if (!(await Bun.file(bundledWorkerUrl).exists())) {
      return;
    }
    const bundledClient = createRenderWorkerClient({
      workerUrl: bundledWorkerUrl.href,
    });
    try {
      const svg = await bundledClient.runSvg({
        kind: "matchToSvg",
        match: sampleCompletedMatch(),
        options: { enableRankedDesigns: false },
      });
      const png = await bundledClient.runPng({
        kind: "svgToPng",
        svg,
      });
      expect(png[0]).toBe(137);
      expect(png[1]).toBe(80);
      expect(png[2]).toBe(78);
      expect(png[3]).toBe(71);
      expect(png.byteLength).toBeGreaterThan(100_000);
    } finally {
      bundledClient.dispose();
    }
  }, 30_000);

  test("7 concurrent 4760x3500 Satori + resvg renders do not stall main-thread heartbeats or timers (>200ms)", async () => {
    await preloadNotificationDelivery();

    // Warm the worker once so we measure steady-state 7-report burst CPU
    // isolation rather than one-time worker boot.
    const warmupClient = createRenderWorkerClient();
    try {
      const warmupSvg = await warmupClient.runSvg({
        kind: "matchToSvg",
        match: sampleCompletedMatch(),
        options: { enableRankedDesigns: false },
      });
      const warmupPng = await svgToPng(warmupSvg);
      expect(warmupPng.byteLength).toBeGreaterThan(100_000);

      const PROBE_INTERVAL_MS = 20;
      let maxEventLoopStallMs = 0;
      let previousTick = performance.now();
      const probeTimer = setInterval(() => {
        const now = performance.now();
        const stall = Math.max(0, now - previousTick - PROBE_INTERVAL_MS);
        if (stall > maxEventLoopStallMs) {
          maxEventLoopStallMs = stall;
        }
        previousTick = now;
      }, PROBE_INTERVAL_MS);

      heartbeatTimeoutMs = 3000; // 1000ms heartbeat interval
      stubs.send.mockImplementation(async () => {
        await Bun.sleep(1300);
        return { id: "100000000000000777" };
      });

      const activities = createScoutNotificationActivities();
      const ref = attemptRef();

      try {
        const burstRenders = Promise.all(
          Array.from({ length: 7 }, async () => {
            const renderedSvg = await warmupClient.runSvg({
              kind: "matchToSvg",
              match: sampleCompletedMatch(),
              options: { enableRankedDesigns: false },
            });
            return await warmupClient.runPng({
              kind: "svgToPng",
              svg: renderedSvg,
            });
          }),
        );

        const [deliveryOutcome, pngBuffers] = await Promise.all([
          activities.deliverNotification(ref),
          burstRenders,
        ]);

        expect(deliveryOutcome).toMatchObject({ outcome: "delivered" });
        expect(pngBuffers).toHaveLength(7);
        for (const png of pngBuffers) {
          // PNG magic header: 0x89 0x50 0x4E 0x47
          expect(png[0]).toBe(137);
          expect(png[1]).toBe(80);
          expect(png[2]).toBe(78);
          expect(png[3]).toBe(71);
          expect(png.byteLength).toBeGreaterThan(100_000);
        }

        // Main-thread event-loop stall stays well below 200ms across all 7
        // concurrent 4760x3500 Satori + resvg renders (~2.5s+ of CPU work).
        expect(maxEventLoopStallMs).toBeLessThan(200);

        // Entry beat (`preparing-notification-v2`), pre-Discord transition beat
        // (`sending-to-discord-v2`), plus at least one 1000ms interval beat
        // while the 7-report burst rendered concurrently.
        expect(heartbeats.length).toBeGreaterThanOrEqual(3);
        expect(heartbeats[0]).toEqual({
          intentKey: ref.intentKey,
          attemptNonce: ref.attemptNonce,
          phase: "preparing-notification-v2",
        });
        expect(heartbeats.at(-1)).toEqual({
          intentKey: ref.intentKey,
          attemptNonce: ref.attemptNonce,
          phase: "sending-to-discord-v2",
        });
      } finally {
        clearInterval(probeTimer);
      }
    } finally {
      warmupClient.dispose();
    }
  }, 30_000);
});
