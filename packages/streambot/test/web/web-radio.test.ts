import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { NoopProvider } from "@shepherdjerred/feature-flags/providers/noop.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { VoiceMutationGate } from "@shepherdjerred/voice-assistant/mutation-gate.ts";
import { NOOP_VOICE_ATTEMPT_OBSERVER } from "@shepherdjerred/voice-assistant/realtime/attempt.ts";
import { Registry } from "prom-client";
import { afterEach, expect, test, vi } from "vitest";
import { mediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  handleStationCommand,
  type StationCommandInteraction,
} from "@shepherdjerred/streambot/discord/commands/station-command-handler.ts";
import { radioCommand } from "@shepherdjerred/streambot/discord/commands/station-commands.ts";
import {
  createStreambotVoiceCommandRouter,
  createVoiceDecisionsRuntime,
} from "@shepherdjerred/streambot/voice/voice-command-router.ts";
import { DryRunVoiceCommandPort } from "@shepherdjerred/streambot/voice/local-voice-probe.ts";
import { playerCommand } from "@shepherdjerred/streambot/web/client-classic/api.ts";
import { formatStationBadge } from "@shepherdjerred/streambot/web/client-classic/station/station-label.ts";
import { SnapshotSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { CuratedStationItem } from "@shepherdjerred/streambot/station/station-types.ts";
import {
  guildId,
  harness,
  number,
  statusChannelId,
  userId,
  voiceChannelId,
} from "#numbered-fixture";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;

afterEach(async () => {
  fixture?.close();
  fixture = undefined;
  await shutdownFeatureFlags();
});

function numberedCuratorItems(
  count: number,
): Promise<readonly CuratedStationItem[]> {
  return Promise.resolve(
    Array.from({ length: count }, (_, idx) => ({
      title: `Station Song ${String(idx + 1)}`,
      source: {
        kind: "url" as const,
        url: `https://www.youtube.com/watch?v=stSong0000${String(idx + 1)}`,
        title: `Station Song ${String(idx + 1)}`,
        mode: "music" as const,
      },
      durationSeconds: 200,
    })),
  );
}

function autoRadioHarness() {
  return harness(3, {
    stationCurators: {
      radio: { curate: ({ count }) => numberedCuratorItems(count) },
    },
    featureGate: {
      numberedChannels: () => Promise.resolve(true),
      automaticChannelRouting: () => Promise.resolve(true),
      assistantV2: () => Promise.resolve(true),
      history: () => Promise.resolve(false),
      musicOverVoice: () => Promise.resolve(true),
      radio: () => Promise.resolve(true),
    },
  });
}

test("evaluates streambot-radio-enabled default true and explicit false", async () => {
  const scope = { guildId: GUILD, channelId: CHANNEL, userId: USER };
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new NoopProvider(),
  });
  expect(await mediaFeatureGate.radio?.(scope)).toBe(true);
  await shutdownFeatureFlags();

  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "static" },
    provider: new StaticProvider({ "streambot-radio-enabled": false }),
  });
  expect(await mediaFeatureGate.radio?.(scope)).toBe(false);
});

test("starts and stops Radio via Web /api/commands, projects snapshot.station, and enforces gates & revisions", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    automatic: true,
  });
  const activeFixture = fixture;

  const initial = SnapshotSchema.parse(
    await activeFixture.playback.snapshot(activeFixture.session, GUILD),
  );
  expect(initial.radioEnabled).toBe(true);
  expect(initial.station).toBeNull();

  activeFixture.setRadioEnabled(false);
  const denied = await activeFixture.handler(
    activeFixture.command({
      action: "station",
      mode: "radio",
      scope: "room",
    }),
  );
  expect(denied.status).toBe(403);
  activeFixture.setRadioEnabled(true);

  const startRes = await activeFixture.handler(
    activeFixture.command({
      action: "station",
      mode: "radio",
      scope: "mine",
      seed: "dream pop",
    }),
  );
  expect(startRes.status).toBe(200);

  await vi.waitFor(async () => {
    const snap = SnapshotSchema.parse(
      await activeFixture.playback.snapshot(activeFixture.session, GUILD),
    );
    expect(snap.station).toEqual({
      kind: "radio",
      scope: "mine",
      seed: "dream pop",
    });
    expect(snap.queue).toHaveLength(2);
  });

  // Stopping a station names no queue position, so it applies to the current state even when
  // the page's revision is stale.
  const stopRes = await activeFixture.handler(
    activeFixture.command({
      action: "station",
      mode: "off",
      revision: "stale-revision",
    }),
  );
  expect(stopRes.status).toBe(200);
  const afterStop = SnapshotSchema.parse(
    await activeFixture.playback.snapshot(activeFixture.session, GUILD),
  );
  expect(afterStop.station).toBeNull();
  expect(afterStop.queue).toHaveLength(0);

  const repeated = await activeFixture.handler(
    activeFixture.command({ action: "station", mode: "off" }),
  );
  expect(repeated.status).toBe(409);
  expect(await repeated.json()).toMatchObject({ code: "no_station" });
});

test("routes Auto-mode Web from Channel 2 onto Channel 1 and follows slot 1", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    automatic: true,
  });
  const activeFixture = fixture;
  const room = await autoRadioHarness();
  activeFixture.playback.deps.sessions = room.manager;

  const videoHandle = room.manager.ensureForPlay({
    guildId: GUILD,
    voiceChannelId: CHANNEL,
    statusChannelId: CHANNEL,
    playbackChannel: number(2),
  });
  videoHandle?.dispatch({
    type: "ADD",
    requesterId: USER,
    source: {
      kind: "url",
      url: "https://example.com/movie.mp4",
      mode: "video",
    },
  });
  await vi.waitFor(() => {
    expect(videoHandle?.view().state).toBe("streaming");
  });

  const beforeSnap = SnapshotSchema.parse(
    await activeFixture.playback.snapshot(activeFixture.session, GUILD),
  );
  expect(beforeSnap.selectionMode).toBe("auto");
  expect(beforeSnap.playbackChannel).toBe(2);

  const startRes = await activeFixture.handler(
    activeFixture.command({
      action: "station",
      mode: "radio",
      scope: "room",
      playbackChannel: beforeSnap.playbackChannel,
      revision: beforeSnap.revision,
      selectionVersion: beforeSnap.selectionVersion,
      slotRevisions: Object.fromEntries(
        beforeSnap.playbackChannels.map((s) => [String(s.number), s.revision]),
      ),
    }),
  );
  expect(startRes.status).toBe(200);

  await vi.waitFor(async () => {
    const afterSnap = SnapshotSchema.parse(
      await activeFixture.playback.snapshot(activeFixture.session, GUILD),
    );
    expect(afterSnap.playbackChannel).toBe(1);
    expect(afterSnap.station?.kind).toBe("radio");
    expect(afterSnap.queue).toHaveLength(2);
  });
  expect(videoHandle?.view().state).toBe("streaming");
});

test("routes Auto-mode Discord /radio start|status|stop onto Channel 1", async () => {
  const room = await autoRadioHarness();
  const config = loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "user",
    VIDEOS_DIR: "/videos",
  });

  expect(radioCommand.name).toBe("radio");
  const replies: string[] = [];
  const makeInteraction = (
    sub: "start" | "status" | "stop",
    seed: string | null = null,
  ): StationCommandInteraction => ({
    commandName: "radio",
    guildId,
    channelId: statusChannelId,
    user: { id: userId },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => (name === "seed" ? seed : null),
    },
    deferReply: () => Promise.resolve(),
    editReply: (payload) => {
      replies.push(payload.content);
      return Promise.resolve();
    },
    reply: (payload) => {
      replies.push(payload.content);
      return Promise.resolve();
    },
  });

  const deps = {
    config,
    getSessions: () => room.manager,
    library: () => [],
    expandPlaylist: () => Promise.resolve([]),
    listSources: () => Promise.resolve([]),
    resolvePlaySource: () => Promise.reject(new Error("unused")),
    featureGate: {
      assistantV2: () => Promise.resolve(true),
      history: () => Promise.resolve(false),
      musicOverVoice: () => Promise.resolve(true),
      automaticChannelRouting: () => Promise.resolve(true),
      numberedChannels: () => Promise.resolve(true),
      radio: () => Promise.resolve(true),
    },
  };

  expect(
    await handleStationCommand(
      makeInteraction("start", "shoegaze"),
      deps,
      () => voiceChannelId,
    ),
  ).toBe(true);
  expect(replies.at(-1)).toContain("channel 1 · Audio");
  expect(
    room.manager.numbered.selection.lastTarget({
      guildId,
      channelId: voiceChannelId,
      userId,
    }),
  ).toBe(number(1));

  await handleStationCommand(
    makeInteraction("status"),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("Radio (shoegaze)");

  await handleStationCommand(
    makeInteraction("stop"),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("Stopped Radio (shoegaze)");
});

test("routes closed voice intents radio_start & radio_stop and formats web station badges", async () => {
  const dryRun = new DryRunVoiceCommandPort();
  for (const [intent, expectedAction] of [
    ["radio_start", "start"],
    ["radio_stop", "stop"],
  ] as const) {
    const runtime = createVoiceDecisionsRuntime({
      apiKey: "sk-voice-radio-test",
      metricsRegister: new Registry(),
      logger: () => {
        /* silent */
      },
      fetch: () =>
        Promise.resolve(
          Response.json({
            id: "dec_radio",
            model: "gpt-6-luna",
            answers: [
              {
                type: "choice",
                name: "intent",
                choice: intent,
                confidence: 0.94,
                probabilities: [{ value: intent, probability: 0.94 }],
              },
            ],
            usage: { input_tokens: 40, output_tokens: 2, total_tokens: 42 },
          }),
        ),
    });
    const router = createStreambotVoiceCommandRouter({
      commands: dryRun,
      runtime,
    });
    const decision = await router({
      command: expectedAction === "start" ? "put on radio" : "stop radio",
      transcript: "Hey Streambot",
      signal: new AbortController().signal,
      mutationGate: new VoiceMutationGate(),
      attempt: NOOP_VOICE_ATTEMPT_OBSERVER.begin(),
      assistantAudio: {
        enqueue: () => {
          /* noop */
        },
        finish: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
      },
    });
    expect(decision.handled).toBe(true);
  }
  expect(dryRun.invocations).toEqual([
    { name: "radio", arguments: { action: "start" } },
    { name: "radio", arguments: { action: "stop" } },
  ]);

  const snapshot = SnapshotSchema.parse({
    channel: { id: CHANNEL, name: "Lounge" },
    playbackChannel: 1,
    playbackChannels: [],
    revision: "rev-1",
    state: "streaming",
    current: {
      title: "Khruangbin — Time",
      durationSeconds: 240,
      mediaKind: "music",
      music: true,
    },
    queue: [],
    positionSeconds: 15,
    paused: false,
    volume: 100,
    loop: "off",
    advancedControls: true,
    sportsEnabled: true,
    radioEnabled: true,
    station: { kind: "radio", scope: "room", seed: "chill funk" },
    restrictedLive: false,
  });

  expect(formatStationBadge({ kind: "radio", scope: "room" })).toBe(
    "RADIO · Room",
  );
  expect(formatStationBadge({ kind: "radio", scope: "mine" })).toBe(
    "RADIO · Mine",
  );
  expect(
    formatStationBadge({ kind: "radio", scope: "room", seed: "chill funk" }),
  ).toBe("RADIO · chill funk");

  const builtCmd = playerCommand(
    { action: "station", mode: "radio", scope: "room", seed: "chill funk" },
    GUILD,
    snapshot,
  );
  expect(builtCmd).toMatchObject({
    action: "station",
    mode: "radio",
    scope: "room",
    seed: "chill funk",
    guildId: GUILD,
    channelId: CHANNEL,
  });
});
