import { normalizeSentryEventPayload } from "#domain/envelope-normalize.ts";
import type { ErrorsRepository } from "#infrastructure/repository-types.ts";
import { CANONICAL_PROJECTS } from "#infrastructure/seed-projects.ts";

function findSeedKey(id: number): string {
  const found = CANONICAL_PROJECTS.find((p) => p.id === id);
  if (found === undefined) {
    throw new Error(`Missing canonical project seed ${String(id)}`);
  }
  return found.publicKey;
}

export async function seedRichDemoFixture(
  repo: ErrorsRepository,
): Promise<void> {
  await repo.seedCanonicalProjects();

  await repo.createRelease({
    project: "scout-for-lol",
    version: "2026.11.20",
    releasedAt: "2026-11-20T18:00:00.000Z",
  });
  await repo.createRelease({
    project: "scout-for-lol",
    version: "2026.11.24",
    releasedAt: "2026-11-24T22:15:00.000Z",
  });
  await repo.createRelease({
    project: "temporal",
    version: "2026.11.24",
    releasedAt: "2026-11-24T20:00:00.000Z",
  });
  await repo.createRelease({
    project: "starlight",
    version: "2026.11.23",
    releasedAt: "2026-11-23T14:30:00.000Z",
  });

  // 1. Regressed high-signal Scout for LoL issue with linked AI-412 badge
  const scoutFirst = await repo.ingestEvent({
    projectId: 1,
    publicKey: findSeedKey(1),
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "f1000000000040008000000000000001",
      timestamp: "2026-11-21T10:12:00.000Z",
      level: "error",
      release: "2026.11.20",
      environment: "production",
      platform: "node",
      transaction: "POST /trpc/matches.ingestTimeline",
      sdk: { name: "sentry.javascript.bun", version: "11.16.0" },
      tags: { region: "na1", queue: "ranked-solo", worker: "scout-backend-0" },
      contexts: {
        runtime: { name: "bun", version: "1.4.5" },
        match: { matchId: "NA1_5182940112", durationSec: 1942 },
      },
      request: {
        method: "POST",
        url: "https://scout.sjer.red/trpc/matches.ingestTimeline",
      },
      breadcrumbs: [
        {
          timestamp: "2026-11-21T10:11:58.200Z",
          category: "http",
          level: "info",
          message:
            "GET https://americas.api.riotgames.com/lol/match/v5/matches/NA1_5182940112/timeline -> 200",
        },
        {
          timestamp: "2026-11-21T10:11:59.950Z",
          category: "db.prisma",
          level: "info",
          message: "SELECT participant frames for puuid",
        },
      ],
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Cannot read properties of undefined (reading 'totalGold')",
            mechanism: { type: "instrument", handled: false },
            stacktrace: {
              frames: [
                {
                  filename: "node_modules/@trpc/server/dist/index.mjs",
                  function: "callProcedure",
                  lineno: 184,
                  colno: 12,
                  in_app: false,
                },
                {
                  filename:
                    "packages/scout-for-lol/src/domain/timeline-diff.ts",
                  module: "domain/timeline-diff",
                  function: "computeLaneGoldDelta",
                  lineno: 87,
                  colno: 29,
                  in_app: true,
                  pre_context: [
                    "const opponentFrame = frame.participantFrames[opponentId];",
                    "const playerFrame = frame.participantFrames[playerId];",
                  ],
                  context_line:
                    "return playerFrame.totalGold - opponentFrame.totalGold;",
                  post_context: ["}"],
                  vars: { playerId: "5", opponentId: "11", minute: 14 },
                },
              ],
            },
          },
        ],
      },
    }),
  });

  if (scoutFirst.status === "accepted") {
    await repo.setTrackerIssue(scoutFirst.issueId, "AI-412");
    await repo.updateIssueState(scoutFirst.issueId, {
      state: "RESOLVED_NEXT_RELEASE",
      resolvedInRelease: "2026.11.20",
    });

    // Regress twice across releases
    await repo.ingestEvent({
      projectId: 1,
      publicKey: findSeedKey(1),
      normalizedEvent: normalizeSentryEventPayload({
        event_id: "f1000000000040008000000000000002",
        timestamp: new Date(Date.now() - 25 * 60_000).toISOString(),
        level: "error",
        release: "2026.11.24",
        environment: "production",
        platform: "node",
        transaction: "POST /trpc/matches.ingestTimeline",
        tags: { region: "euw1", queue: "ranked-solo" },
        exception: {
          values: [
            {
              type: "TypeError",
              value:
                "Cannot read properties of undefined (reading 'totalGold')",
              stacktrace: {
                frames: [
                  {
                    filename:
                      "packages/scout-for-lol/src/domain/timeline-diff.ts",
                    module: "domain/timeline-diff",
                    function: "computeLaneGoldDelta",
                    lineno: 89,
                    colno: 29,
                    in_app: true,
                    pre_context: [
                      "const opponentFrame = frame.participantFrames[opponentId];",
                      "const playerFrame = frame.participantFrames[playerId];",
                    ],
                    context_line:
                      "return playerFrame.totalGold - opponentFrame.totalGold;",
                    post_context: ["}"],
                    vars: { playerId: "2", opponentId: "10", minute: 15 },
                  },
                ],
              },
            },
          ],
        },
      }),
    });
  }

  // 2. Open Temporal workflow activity timeout issue
  await repo.ingestEvent({
    projectId: 12,
    publicKey: findSeedKey(12),
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "f2000000000040008000000000000001",
      timestamp: new Date(Date.now() - 12 * 60_000).toISOString(),
      level: "error",
      release: "2026.11.24",
      environment: "production",
      platform: "node",
      transaction: "activity:reconcileControlPlaneSnapshot",
      tags: { taskQueue: "homelab-control", namespace: "prod" },
      exception: {
        values: [
          {
            type: "ActivityFailure",
            value: "ArgoCD application tree read timed out after 15000ms",
            stacktrace: {
              frames: [
                {
                  filename: "packages/temporal/src/activities/argocd.ts",
                  function: "fetchApplicationTree",
                  lineno: 54,
                  colno: 11,
                  in_app: true,
                  pre_context: [
                    "const res = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });",
                  ],
                  context_line:
                    "if (!res.ok) throw new ActivityFailure(`ArgoCD status ${res.status}`);",
                  post_context: [
                    "return ApplicationTreeSchema.parse(await res.json());",
                  ],
                  vars: { appName: "root-homelab" },
                },
              ],
            },
          },
        ],
      },
    }),
  });

  // 3. Open Better Skill Capped browser issue
  await repo.ingestEvent({
    projectId: 3,
    publicKey: findSeedKey(3),
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "f3000000000040008000000000000001",
      timestamp: new Date(Date.now() - 90 * 60_000).toISOString(),
      level: "warning",
      release: "2026.11.19",
      environment: "production",
      platform: "javascript",
      transaction: "/courses/jungle-tempo",
      tags: { browser: "Safari 18.1" },
      exception: {
        values: [
          {
            type: "DOMException",
            value: "The play() request was interrupted by a call to pause().",
            stacktrace: {
              frames: [
                {
                  filename:
                    "https://better-skill-capped.sjer.red/assets/player-9aBcDe12.js",
                  function: "syncPlaybackRate",
                  lineno: 142,
                  colno: 17,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    }),
  });

  // 4. Muted Birmel Discord gateway reconnect noise
  const birmelNoise = await repo.ingestEvent({
    projectId: 7,
    publicKey: findSeedKey(7),
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "f4000000000040008000000000000001",
      timestamp: new Date(Date.now() - 4 * 3_600_000).toISOString(),
      level: "warning",
      release: "2026.11.22",
      environment: "production",
      platform: "node",
      transaction: "discord.shardResume",
      message: "WebSocket shard 0 closed with code 1001; resuming session",
    }),
  });
  if (birmelNoise.status === "accepted") {
    await repo.updateIssueState(birmelNoise.issueId, { state: "MUTED" });
  }

  // 5. Resolved Starlight issue
  const starlightResolved = await repo.ingestEvent({
    projectId: 5,
    publicKey: findSeedKey(5),
    normalizedEvent: normalizeSentryEventPayload({
      event_id: "f5000000000040008000000000000001",
      timestamp: "2026-11-23T15:00:00.000Z",
      level: "error",
      release: "2026.11.23",
      environment: "production",
      platform: "node",
      transaction: "command:/karma",
      exception: {
        values: [
          {
            type: "SqliteError",
            value: "database is locked",
            stacktrace: {
              frames: [
                {
                  filename: "packages/starlight-karma-bot/src/db/karma.ts",
                  function: "incrementKarma",
                  lineno: 31,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    }),
  });
  if (starlightResolved.status === "accepted") {
    await repo.updateIssueState(starlightResolved.issueId, {
      state: "RESOLVED",
    });
  }
}
