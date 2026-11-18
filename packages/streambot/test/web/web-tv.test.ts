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
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { mediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  handleStationCommand,
  type StationCommandInteraction,
} from "@shepherdjerred/streambot/discord/commands/station-command-handler.ts";
import { tvCommand } from "@shepherdjerred/streambot/discord/commands/station-commands.ts";
import { gateRestoredStation } from "@shepherdjerred/streambot/station/station-session-ops.ts";
import type { CuratedStationItem } from "@shepherdjerred/streambot/station/station-types.ts";
import {
  createStreambotVoiceCommandRouter,
  createVoiceDecisionsRuntime,
} from "@shepherdjerred/streambot/voice/voice-command-router.ts";
import { DryRunVoiceCommandPort } from "@shepherdjerred/streambot/voice/local-voice-probe.ts";
import { formatStationBadge } from "@shepherdjerred/streambot/web/client/station/station-label.ts";
import { SnapshotSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  guildId,
  harness,
  number,
  statusChannelId,
  userId,
  voiceChannelId,
} from "#numbered-fixture";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";

let activeWeb: ReturnType<typeof webFixture> | undefined;

afterEach(async () => {
  activeWeb?.close();
  activeWeb = undefined;
  await shutdownFeatureFlags();
});

function buildCuratedVideoBatch(
  preset: string,
  count: number,
): Promise<readonly CuratedStationItem[]> {
  return Promise.resolve(
    Array.from({ length: count }, (_, idx) => ({
      title: `TV ${preset} #${String(idx + 1)}`,
      source: {
        kind: "file" as const,
        path: `/media/tv/${preset}-${String(idx + 1)}.mkv`,
        title: `TV ${preset} #${String(idx + 1)}`,
        mode: "video" as const,
      },
      durationSeconds: 1800,
    })),
  );
}

function buildCuratedAudioBatch(
  count: number,
): Promise<readonly CuratedStationItem[]> {
  return Promise.resolve(
    Array.from({ length: count }, (_, idx) => ({
      title: `Audio Track #${String(idx + 1)}`,
      source: {
        kind: "url" as const,
        url: `https://www.youtube.com/watch?v=audTrack00${String(idx + 1)}`,
        title: `Audio Track #${String(idx + 1)}`,
        mode: "music" as const,
      },
      durationSeconds: 210,
    })),
  );
}

const alwaysEnabled = () => Promise.resolve(true);
const alwaysDisabled = () => Promise.resolve(false);
const testStationFeatureGate = {
  numberedChannels: alwaysEnabled,
  automaticChannelRouting: alwaysEnabled,
  assistantV2: alwaysEnabled,
  history: alwaysDisabled,
  musicOverVoice: alwaysEnabled,
  radio: alwaysEnabled,
  tv: alwaysEnabled,
};

const emptySources = () => Promise.resolve([]);
const unusedCommandStubs = {
  featureGate: testStationFeatureGate,
  library: () => [],
  expandPlaylist: emptySources,
  listSources: emptySources,
  resolvePlaySource: () => Promise.reject(new Error("unused-in-station-test")),
};

function dualStationHarness() {
  return harness(3, {
    ...unusedCommandStubs,
    stationCurators: {
      radio: { curate: ({ count }) => buildCuratedAudioBatch(count) },
      tv: {
        curate: ({ station, count }) =>
          buildCuratedVideoBatch(station.tvPreset ?? "my-mix", count),
      },
    },
  });
}

test("evaluates streambot-tv-enabled default true, explicit false, and gates restored TV stations", async () => {
  const scope = { guildId: GUILD, channelId: CHANNEL, userId: USER };
  const persistedTv = {
    kind: "tv" as const,
    scope: "room" as const,
    ownerId: USER,
    tvPreset: "sitcoms" as const,
    recentIdentities: [],
    skippedIdentities: [],
  };

  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new NoopProvider(),
  });
  expect(await mediaFeatureGate.tv?.(scope)).toBe(true);
  expect(
    await gateRestoredStation(mediaFeatureGate, GUILD, CHANNEL, persistedTv),
  ).toEqual(persistedTv);
  await shutdownFeatureFlags();

  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "static" },
    provider: new StaticProvider({ "streambot-tv-enabled": false }),
  });
  expect(await mediaFeatureGate.tv?.(scope)).toBe(false);
  expect(
    await gateRestoredStation(mediaFeatureGate, GUILD, CHANNEL, persistedTv),
  ).toBeUndefined();
});

test("starts and stops Web TV Mode across presets, formats badges, rejects Slot 1, and routes Auto onto Slot 2", async () => {
  activeWeb = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    automatic: true,
  });
  const web = activeWeb;
  const room = await dualStationHarness();
  web.playback.deps.sessions = room.manager;

  const initial = SnapshotSchema.parse(
    await web.playback.snapshot(web.session, GUILD),
  );
  expect(initial.tvEnabled).toBe(true);
  expect(initial.station).toBeNull();

  web.setTvEnabled(false);
  const forbidden = await web.handler(
    web.command({
      action: "station",
      mode: "tv",
      tvPreset: "sitcoms",
      scope: "room",
      playbackChannel: initial.playbackChannel,
      revision: initial.revision,
      selectionVersion: initial.selectionVersion,
    }),
  );
  expect(forbidden.status).toBe(403);
  web.setTvEnabled(true);

  // Start audio on Slot 1 first so Auto starts while viewing Slot 1.
  const audioSlot = room.manager.ensureForPlay({
    guildId: GUILD,
    voiceChannelId: CHANNEL,
    statusChannelId: CHANNEL,
    playbackChannel: number(1),
  });
  audioSlot?.dispatch({
    type: "ADD",
    requesterId: USER,
    source: {
      kind: "url",
      url: "https://example.com/song.opus",
      mode: "music",
    },
  });
  await vi.waitFor(() => {
    expect(audioSlot?.view().state).toBe("streaming");
  });

  const beforeTv = SnapshotSchema.parse(
    await web.playback.snapshot(web.session, GUILD),
  );
  expect(beforeTv.selectionMode).toBe("auto");
  expect(beforeTv.playbackChannel).toBe(1);

  for (const preset of [
    "my-mix",
    "continue-series",
    "sitcoms",
    "movies",
    "youtube",
  ] as const) {
    const snap = SnapshotSchema.parse(
      await web.playback.snapshot(web.session, GUILD),
    );
    const res = await web.handler(
      web.command({
        action: "station",
        mode: "tv",
        tvPreset: preset,
        scope: "mine",
        seed: preset === "sitcoms" ? "The Bear" : undefined,
        playbackChannel: snap.playbackChannel,
        revision: snap.revision,
        selectionVersion: snap.selectionVersion,
        slotRevisions: Object.fromEntries(
          snap.playbackChannels.map((slot) => [
            String(slot.number),
            slot.revision,
          ]),
        ),
      }),
    );
    expect(res.status).toBe(200);

    await vi.waitFor(async () => {
      const updated = SnapshotSchema.parse(
        await web.playback.snapshot(web.session, GUILD),
      );
      expect(updated.playbackChannel).toBe(2);
      expect(updated.station).toEqual({
        kind: "tv",
        scope: "mine",
        tvPreset: preset,
        ...(preset === "sitcoms" ? { seed: "The Bear" } : {}),
      });
    });
  }
  expect(audioSlot?.view().state).toBe("streaming");

  expect(
    formatStationBadge({ kind: "tv", scope: "room", tvPreset: "my-mix" }),
  ).toBe("TV · My Mix");
  expect(
    formatStationBadge({
      kind: "tv",
      scope: "room",
      tvPreset: "continue-series",
    }),
  ).toBe("TV · Continue Series");
  expect(
    formatStationBadge({
      kind: "tv",
      scope: "mine",
      tvPreset: "sitcoms",
      seed: "The Bear",
    }),
  ).toBe("TV · Sitcoms · The Bear");

  // Stop TV on Slot 2 via mode: "off".
  const activeSnap = SnapshotSchema.parse(
    await web.playback.snapshot(web.session, GUILD),
  );
  const stopRes = await web.handler(
    web.command({
      action: "station",
      mode: "off",
      playbackChannel: activeSnap.playbackChannel,
      revision: activeSnap.revision,
      selectionVersion: activeSnap.selectionVersion,
    }),
  );
  expect(stopRes.status).toBe(200);

  // Explicitly lock viewer onto Channel 1 (audio) and verify TV Mode is rejected with 400.
  const preSelect = SnapshotSchema.parse(
    await web.playback.snapshot(web.session, GUILD),
  );
  const selectRes = await web.handler(
    web.command({
      action: "select",
      number: 1,
      playbackChannel: preSelect.playbackChannel,
      revision: preSelect.revision,
      selectionVersion: preSelect.selectionVersion,
    }),
  );
  expect(selectRes.status).toBe(200);

  const manualSlot1 = SnapshotSchema.parse(
    await web.playback.snapshot(web.session, GUILD),
  );
  const rejectedOnAudio = await web.handler(
    web.command({
      action: "station",
      mode: "tv",
      tvPreset: "movies",
      playbackChannel: manualSlot1.playbackChannel,
      revision: manualSlot1.revision,
      selectionVersion: manualSlot1.selectionVersion,
    }),
  );
  expect(rejectedOnAudio.status).toBe(400);
});

test("runs Discord /tv start|status|stop on Slot 2 alongside /radio on Slot 1 simultaneously", async () => {
  const room = await dualStationHarness();
  const config = loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "user",
    VIDEOS_DIR: "/videos",
  });

  expect(tvCommand.name).toBe("tv");
  const replies: string[] = [];
  const recordReply = (payload: { content: string }) => {
    replies.push(payload.content);
    return Promise.resolve();
  };
  const buildStationInteraction = (input: {
    readonly commandName: "tv" | "radio";
    readonly sub: "start" | "status" | "stop";
    readonly preset?: string;
    readonly seed?: string;
    readonly scope?: string;
  }): StationCommandInteraction => ({
    commandName: input.commandName,
    guildId,
    channelId: statusChannelId,
    user: { id: userId },
    options: {
      getSubcommand: () => input.sub,
      getString: (name: string) => {
        if (name === "preset") return input.preset ?? null;
        if (name === "seed") return input.seed ?? null;
        return name === "scope" ? (input.scope ?? null) : null;
      },
    },
    deferReply: () => Promise.resolve(),
    editReply: recordReply,
    reply: recordReply,
  });

  const deps = {
    config,
    getSessions: () => room.manager,
    ...unusedCommandStubs,
  };

  // Reject /tv start when user manually selected Channel 1 (Audio).
  const scope = { guildId, channelId: voiceChannelId, userId };
  await room.manager.numbered.select(scope, 1);
  await handleStationCommand(
    buildStationInteraction({ commandName: "tv", sub: "start" }),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("TV mode requires a video channel (2+)");

  // Restore Auto mode, start /radio on Slot 1 and /tv on Slot 2 simultaneously.
  await room.manager.numbered.reset(scope);
  await handleStationCommand(
    buildStationInteraction({
      commandName: "radio",
      sub: "start",
      seed: "lofi",
    }),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("channel 1 · Audio");

  await handleStationCommand(
    buildStationInteraction({
      commandName: "tv",
      sub: "start",
      preset: "sitcoms",
      seed: "The Bear",
    }),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("channel 2 · Video");
  expect(room.manager.numbered.selection.lastTarget(scope)).toBe(number(2));

  // Both stations report status independently.
  await handleStationCommand(
    buildStationInteraction({ commandName: "tv", sub: "status" }),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("channel 2 · Video");
  expect(replies.at(-1)).toContain("TV (Sitcoms · The Bear)");
  expect(replies.at(-1)).toContain("preset: `sitcoms`");

  await handleStationCommand(
    buildStationInteraction({ commandName: "radio", sub: "status" }),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("channel 1 · Audio");
  expect(replies.at(-1)).toContain("Radio (lofi)");

  // Stopping /tv stops Slot 2 TV while keeping Slot 1 Radio running.
  await handleStationCommand(
    buildStationInteraction({ commandName: "tv", sub: "stop" }),
    deps,
    () => voiceChannelId,
  );
  expect(replies.at(-1)).toContain("Stopped TV (Sitcoms · The Bear)");
  expect(
    room.manager.getExisting(guildId, voiceChannelId, number(1))?.station?.()
      ?.kind,
  ).toBe("radio");
  expect(
    room.manager.getExisting(guildId, voiceChannelId, number(2))?.station?.(),
  ).toBeNull();
});

test("routes closed voice TV intents and executes voice TV start/stop on Slot 2", async () => {
  const dryRun = new DryRunVoiceCommandPort();
  for (const [utterance, intent] of [
    ["start sitcoms tv", "tv_sitcoms"],
    ["start continue series tv", "tv_continue_series"],
    ["turn on tv", "tv_start"],
    ["stop tv", "tv_stop"],
  ] as const) {
    const runtime = createVoiceDecisionsRuntime({
      apiKey: "sk-voice-tv-test",
      metricsRegister: new Registry(),
      logger: () => {
        /* silent */
      },
      fetch: () =>
        Promise.resolve(
          Response.json({
            id: "dec_tv",
            model: "gpt-6-luna",
            answers: [
              {
                type: "choice",
                name: "intent",
                choice: intent,
                confidence: 0.95,
                probabilities: [{ value: intent, probability: 0.95 }],
              },
            ],
            usage: { input_tokens: 42, output_tokens: 2, total_tokens: 44 },
          }),
        ),
    });
    const router = createStreambotVoiceCommandRouter({
      commands: dryRun,
      runtime,
    });
    const result = await router({
      command: utterance,
      transcript: `Hey Streambot, ${utterance}`,
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
    expect(result.handled).toBe(true);
  }

  expect(dryRun.invocations).toEqual([
    { name: "tv", arguments: { action: "start", preset: "sitcoms" } },
    { name: "tv", arguments: { action: "start", preset: "continue-series" } },
    { name: "tv", arguments: { action: "start" } },
    { name: "tv", arguments: { action: "stop" } },
  ]);

  // Verify real PlaybackCommandService.tv routes onto Slot 2 and follows Slot 2 in Auto mode.
  const room = await dualStationHarness();
  const scope = { guildId, channelId: voiceChannelId, userId };
  const cmdDeps = await room.manager.numbered.commandDeps(
    scope,
    statusChannelId,
  );
  const service = new PlaybackCommandService(cmdDeps);
  const signal = new AbortController().signal;

  const startedText = await service.tv(
    userId,
    { action: "start", preset: "sitcoms" },
    signal,
  );
  expect(startedText).toContain("Started TV (Sitcoms)");
  expect(room.manager.numbered.selection.lastTarget(scope)).toBe(number(2));
  expect(
    room.manager.getExisting(guildId, voiceChannelId, number(2))?.station?.(),
  ).toMatchObject({
    kind: "tv",
    tvPreset: "sitcoms",
  });

  const stoppedText = await service.tv(userId, { action: "stop" }, signal);
  expect(stoppedText).toBe("Stopped TV (Sitcoms).");
});
