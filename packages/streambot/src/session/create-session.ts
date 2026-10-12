import { createActor } from "xstate";
import { webRemoteUrl } from "@shepherdjerred/streambot/discord/web-link.ts";
import { playerCardEnabled } from "@shepherdjerred/streambot/config/dynamic.ts";
import { StatusReporter } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type { PosterFetcher } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import { buildPlaybackActors } from "@shepherdjerred/streambot/session/playback-actors.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import { PlayerCardManager } from "@shepherdjerred/streambot/discord/player-card/player-card-manager.ts";
import {
  CHECKPOINT_MS,
  keyOf,
  type Session,
  type SpawnParams,
  type SessionManagerDeps,
} from "@shepherdjerred/streambot/session/session-types.ts";
import { createPlaybackInspector } from "@shepherdjerred/streambot/session/playback-log.ts";
import { createSessionVoiceAssistant } from "@shepherdjerred/streambot/session/voice-session-factory.ts";
import { SessionObserver } from "@shepherdjerred/streambot/session/session-observer.ts";
import { TeardownHold } from "@shepherdjerred/streambot/session/teardown-hold.ts";
import type {
  GuildId,
  ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
type CreateSessionOptions = {
  deps: SessionManagerDeps;
  fetchPoster: PosterFetcher | undefined;
  sessions: Map<string, Session>;
  teardown: (session: Session) => void;
  beginVoiceRecovery: (session: Session) => void;
  totalQueueLength: () => number;
  updateStates: () => void;
  saveSnapshot: (session: Session) => Promise<void>;
  refreshAssistant: (guildId: GuildId, channelId: ChannelId) => Promise<void>;
};
export function createSession(
  params: SpawnParams,
  options: CreateSessionOptions,
): Session {
  const identity =
    params.playbackChannel === undefined
      ? {}
      : {
          playbackChannel: params.playbackChannel,
          instanceId: params.instanceId ?? crypto.randomUUID(),
        };
  const { entry } = params;
  const actors = buildPlaybackActors({
    entry,
    resolveSource: options.deps.resolveSource,
    teardownHold: () => session.teardownHold,
  });
  const actor = createActor(createPlaybackMachine(actors), {
    input: params.input,
    inspect: createPlaybackInspector(
      keyOf(params.guildId, params.voiceChannelId),
    ),
  });
  const reporter = new StatusReporter((message) =>
    options.deps.announce(params.statusChannelId, message),
  );
  // Build before the session record so `view()` can close over actor and userbot directly.
  const card = new PlayerCardManager({
    webUrl: (requester) =>
      webRemoteUrl(
        options.deps.config,
        params.guildId,
        requester,
        params.playbackChannel,
      ),
    owner: {
      ...identity,
      guildId: params.guildId,
      voiceChannelId: params.voiceChannelId,
    },
    statusChannelId: params.statusChannelId,
    port: options.deps.cards,
    view: () =>
      buildPlaybackView(actor.getSnapshot(), entry.userbot.getPosition()),
    enabled: playerCardEnabled(options.deps.config.playerCard.enabled),
    tickMs: options.deps.config.playerCard.tickMs,
    repostAfterMessages: options.deps.config.playerCard.repostAfterMessages,
    ...(options.fetchPoster === undefined
      ? {}
      : { fetchPoster: options.fetchPoster }),
  });

  const session: Session = {
    ...identity,
    key: keyOf(params.guildId, params.voiceChannelId, params.playbackChannel),
    guildId: params.guildId,
    voiceChannelId: params.voiceChannelId,
    statusChannelId: params.statusChannelId,
    entry,
    actor,
    reporter,
    card,
    unsubscribe: () => {
      /* replaced once the actor subscription is created below */
    },
    hasStarted: false,
    persistResumeKey: params.resumeKey,
    persistResumeAttempts: params.resumeAttempts,
    resumeConfirmed: false,
    bootAtMs: Date.now(),
    lastKnownPositionSeconds: params.seekSeconds ?? 0,
    checkpointTimer: null,
    snapshotTail: Promise.resolve(),
    torndown: false,
    preserveStateOnTeardown: params.preserveStateOnTeardown ?? false,
    reconnectAttempts: params.reconnectAttempts ?? 0,
    recoveredFromVoiceLoss: params.recoveredFromVoiceLoss ?? false,
    voiceRecoveryStarted: false,
    pendingSubtitleMenu: false,
    historyRunRecorded: false,
    voiceAssistant: null,
    teardownHold: new TeardownHold(() => {
      options.teardown(session);
    }),
  };
  if (params.playbackChannel === undefined)
    session.voiceAssistant = createSessionVoiceAssistant(options.deps, session);
  // Trigger 1: the fork's voice ws `close` event, including silent-to-EOF cases.
  entry.userbot.setVoiceCloseListener((info) => {
    if (session.playbackChannel !== undefined && info.source === "go-live") {
      if (info.deliberate) {
        session.actor.send({
          type: "STREAMER_VOICE_DETACHED",
          reason: "Go Live was disconnected",
        });
        return;
      }
      session.actor.send({
        type: "PRODUCER_STALLED",
        reason: "Go Live connection lost",
        positionSeconds: entry.userbot.getPosition() ?? 0,
      });
      return;
    }
    options.beginVoiceRecovery(session);
  });
  // Stall watchdog: ffmpeg alive but producing nothing → the machine's bounded stall recovery
  // (retry at position, pipeline ladder). Without this the machine would sit in `streaming`
  // forever on a wedged pipeline.
  entry.userbot.setStallListener((info) => {
    session.actor.send({
      type: "PRODUCER_STALLED",
      reason: info.reason,
      positionSeconds: info.positionSeconds,
    });
  });

  const observer = new SessionObserver({
    session,
    history: options.deps.history,
    totalQueueLength: () => options.totalQueueLength(),
    updateStates: options.updateStates,
  });
  const subscription = actor.subscribe((snapshot) => {
    observer.handle(snapshot);
  });
  session.unsubscribe = () => {
    subscription.unsubscribe();
  };

  options.sessions.set(session.key, session);
  actor.start();
  session.checkpointTimer = setInterval(() => {
    void options.saveSnapshot(session);
  }, CHECKPOINT_MS);
  if (session.playbackChannel !== undefined)
    void options.refreshAssistant(session.guildId, session.voiceChannelId);
  return session;
}
