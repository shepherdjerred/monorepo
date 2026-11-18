import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type {
  PlaybackContext,
  PlaybackEvent,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { MediaMode } from "@shepherdjerred/streambot/sources/media-kind.ts";
import {
  sourceIdentity,
  withMode,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import {
  appendStationRingBuffer,
  MAX_STATION_RECENT_IDENTITIES,
  MAX_STATION_SKIPPED_IDENTITIES,
  type PersistedStation,
} from "@shepherdjerred/streambot/state/station-schema.ts";
import type {
  ChannelId,
  GuildId,
  UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  playbackTransport,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  collectActiveExclusions,
  isSessionStillOnStation,
  recordStationHistoryRequest,
  snapshotStateName,
} from "./station-feeder-helpers.ts";
import type {
  CuratedStationItem,
  StationCuratorRegistry,
} from "./station-types.ts";

const log = logger.child("station-feeder");

export const STATION_LOW_WATER = 2;
const EMPTY_CURATION_COOLDOWN_MS = 15_000;

export type StationSessionTarget = {
  readonly key: string;
  readonly guildId: GuildId;
  voiceChannelId: ChannelId;
  readonly playbackChannel?: PlaybackChannelNumber | undefined;
  readonly torndown: boolean;
  readonly voiceRecoveryStarted: boolean;
  station: PersistedStation | undefined;
  readonly actor: {
    getSnapshot: () => {
      readonly value: unknown;
      readonly context: PlaybackContext;
    };
    send: (event: PlaybackEvent) => void;
  };
};

export type StationFeederDeps = {
  readonly curators: StationCuratorRegistry;
  readonly history?: MediaHistoryStore | undefined;
  readonly featureGate?: MediaFeatureGate | undefined;
  readonly voiceRoomHumanIds?:
    ((guildId: GuildId, channelId: ChannelId) => readonly UserId[]) | undefined;
  readonly saveSnapshot?:
    ((session: StationSessionTarget) => Promise<void>) | undefined;
};

type InFlightCuration = {
  readonly controller: AbortController;
  readonly promise: Promise<readonly CuratedStationItem[]>;
};

export class StationFeeder {
  private readonly inFlight = new Map<string, InFlightCuration>();
  private readonly emptyCooldownUntil = new Map<string, number>();
  private readonly manualIdentities = new Map<string, Set<string>>();

  constructor(private readonly deps: StationFeederDeps) {}

  onBeforeDispatch(session: StationSessionTarget, event: PlaybackEvent): void {
    if (
      event.type === "STOP" ||
      event.type === "LEAVE" ||
      event.type === "CLEAR"
    ) {
      if (session.station !== undefined) {
        session.station = undefined;
        void this.deps.saveSnapshot?.(session);
      }
      this.manualIdentities.delete(session.key);
      this.abort(session);
      return;
    }
    if (session.station === undefined) return;
    if (
      event.type === "ADD" ||
      event.type === "ADD_NEXT" ||
      event.type === "PLAY_NOW"
    ) {
      this.recordManualSources(session.key, [event.source]);
      return;
    }
    if (event.type === "ADD_BATCH") {
      this.recordManualSources(
        session.key,
        event.items.map((entry) => entry.source),
      );
      return;
    }
    if (event.type === "SKIP") {
      const current = session.actor.getSnapshot().context.current;
      if (current !== null) {
        session.station = {
          ...session.station,
          skippedIdentities: appendStationRingBuffer(
            session.station.skippedIdentities,
            sourceIdentity(current.source),
            MAX_STATION_SKIPPED_IDENTITIES,
          ),
        };
        this.emptyCooldownUntil.delete(session.key);
      }
    }
  }

  private recordManualSources(
    sessionKey: string,
    sources: readonly Source[],
  ): void {
    let set = this.manualIdentities.get(sessionKey);
    if (set === undefined) {
      set = new Set<string>();
      this.manualIdentities.set(sessionKey, set);
    }
    for (const source of sources) {
      set.add(sourceIdentity(source));
    }
  }

  stop(session: StationSessionTarget): PersistedStation | null {
    const previous = session.station;
    session.station = undefined;
    this.manualIdentities.delete(session.key);
    this.abort(session);
    this.emptyCooldownUntil.delete(session.key);
    if (previous === undefined) return null;

    const recentSet = new Set<string>(previous.recentIdentities);
    const queue = session.actor.getSnapshot().context.queue;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const queued = queue[index];
      if (queued === undefined || !recentSet.has(sourceIdentity(queued.source)))
        continue;
      if (queued.requestId !== undefined) {
        this.deps.history?.updateRequest(queued.requestId, "removed");
      }
      session.actor.send({ type: "REMOVE", index: index + 1 });
    }
    void this.deps.saveSnapshot?.(session);
    return previous;
  }

  abort(session: Pick<StationSessionTarget, "key">): void {
    const running = this.inFlight.get(session.key);
    if (running !== undefined) {
      running.controller.abort();
      this.inFlight.delete(session.key);
    }
  }

  resetCooldown(session: Pick<StationSessionTarget, "key">): void {
    this.emptyCooldownUntil.delete(session.key);
  }

  poke(session: StationSessionTarget): void {
    if (!this.canRefillNow(session, true)) return;
    void this.refillOnce(session);
  }

  async ensureLookahead(
    session: StationSessionTarget,
    callerSignal?: AbortSignal,
  ): Promise<readonly CuratedStationItem[]> {
    this.emptyCooldownUntil.delete(session.key);
    const allAdded: CuratedStationItem[] = [];
    for (let pass = 0; pass < 2; pass += 1) {
      if (callerSignal?.aborted === true || !this.canRefillNow(session, false))
        break;
      const batch = await this.refillOnce(session, callerSignal);
      allAdded.push(...batch);
      if (batch.length === 0) break;
      await Promise.resolve();
    }
    return allAdded;
  }

  private canRefillNow(
    session: StationSessionTarget,
    respectCooldown: boolean,
  ): boolean {
    if (
      session.station === undefined ||
      session.torndown ||
      session.voiceRecoveryStarted
    ) {
      return false;
    }
    if (
      respectCooldown &&
      (this.emptyCooldownUntil.get(session.key) ?? 0) > Date.now()
    ) {
      return false;
    }
    const snapshot = session.actor.getSnapshot();
    return (
      snapshotStateName(snapshot) !== "leaving" &&
      !this.hasPendingManualTrack(session.key, snapshot.context) &&
      snapshot.context.queue.length < STATION_LOW_WATER
    );
  }

  private hasPendingManualTrack(
    sessionKey: string,
    context: PlaybackContext,
  ): boolean {
    const manual = this.manualIdentities.get(sessionKey);
    if (manual === undefined || manual.size === 0) return false;
    const active = [
      ...(context.current === null ? [] : [context.current]),
      ...context.queue,
    ];
    if (active.some((entry) => manual.has(sourceIdentity(entry.source)))) {
      return true;
    }
    this.manualIdentities.delete(sessionKey);
    return false;
  }

  private refillOnce(
    session: StationSessionTarget,
    callerSignal?: AbortSignal,
  ): Promise<readonly CuratedStationItem[]> {
    const existing = this.inFlight.get(session.key);
    if (existing !== undefined) return existing.promise;

    const controller = new AbortController();
    const onCallerAbort = () => {
      controller.abort();
    };
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    const promise = (async () => {
      try {
        return await this.executeRefill(session, controller);
      } finally {
        callerSignal?.removeEventListener("abort", onCallerAbort);
        if (this.inFlight.get(session.key)?.controller === controller) {
          this.inFlight.delete(session.key);
        }
      }
    })();
    this.inFlight.set(session.key, { controller, promise });
    return promise;
  }

  private async executeRefill(
    session: StationSessionTarget,
    controller: AbortController,
  ): Promise<readonly CuratedStationItem[]> {
    const station = session.station;
    if (station === undefined || session.torndown) return [];
    const curator =
      station.kind === "radio"
        ? this.deps.curators.radio
        : this.deps.curators.tv;
    const humanListeners =
      this.deps.voiceRoomHumanIds === undefined
        ? [station.ownerId]
        : this.deps.voiceRoomHumanIds(session.guildId, session.voiceChannelId);
    if (curator === undefined || humanListeners.length === 0) return [];

    const scope = {
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      userId: station.ownerId,
    };
    if (!(await this.checkStationEnabled(session, station, scope))) return [];
    if (!isSessionStillOnStation(session, station.kind, controller.signal))
      return [];

    const needed = this.computeNeededCount(session);
    if (needed <= 0) return [];
    const mode = await this.resolveStationMediaMode(session, station);
    if (!isSessionStillOnStation(session, station.kind, controller.signal))
      return [];

    const curated = await this.curateBatch({
      session,
      station,
      curator,
      humanListeners,
      needed,
      mode,
      signal: controller.signal,
    });
    if (!isSessionStillOnStation(session, station.kind, controller.signal))
      return [];
    if (curated.length === 0) {
      this.emptyCooldownUntil.set(
        session.key,
        Date.now() + EMPTY_CURATION_COOLDOWN_MS,
      );
      return [];
    }

    const historyAllowed =
      this.deps.history !== undefined &&
      (this.deps.featureGate === undefined ||
        (await this.deps.featureGate.history(scope)));
    if (!isSessionStillOnStation(session, station.kind, controller.signal))
      return [];

    return this.dispatchBatch({
      session,
      curated,
      needed,
      mode,
      scope,
      historyAllowed,
    });
  }

  private async checkStationEnabled(
    session: StationSessionTarget,
    station: PersistedStation,
    scope: { guildId: string; channelId: string; userId: string },
  ): Promise<boolean> {
    if (
      station.kind === "radio" &&
      this.deps.featureGate?.radio !== undefined
    ) {
      const enabled = await this.deps.featureGate.radio(scope);
      if (!enabled) {
        if (session.station === station) session.station = undefined;
        return false;
      }
    }
    return true;
  }

  private computeNeededCount(session: StationSessionTarget): number {
    const snapshot = session.actor.getSnapshot();
    return snapshotStateName(snapshot) === "leaving"
      ? 0
      : STATION_LOW_WATER - snapshot.context.queue.length;
  }

  private async curateBatch(input: {
    readonly session: StationSessionTarget;
    readonly station: PersistedStation;
    readonly curator: NonNullable<StationCuratorRegistry["radio"]>;
    readonly humanListeners: readonly UserId[];
    readonly needed: number;
    readonly mode: MediaMode;
    readonly signal: AbortSignal;
  }): Promise<readonly CuratedStationItem[]> {
    const { excludeIdentities, excludeWorkKeys } = collectActiveExclusions(
      input.session.actor.getSnapshot().context,
      input.station,
    );
    try {
      return await input.curator.curate({
        guildId: input.session.guildId,
        channelId: input.session.voiceChannelId,
        playbackChannel: input.session.playbackChannel,
        station: input.station,
        listenerIds: input.humanListeners,
        excludeIdentities,
        excludeWorkKeys,
        count: input.needed,
        mode: input.mode,
        signal: input.signal,
      });
    } catch (error) {
      log.warn("station curation failed", {
        kind: input.station.kind,
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  private dispatchBatch(input: {
    readonly session: StationSessionTarget;
    readonly curated: readonly CuratedStationItem[];
    readonly needed: number;
    readonly mode: MediaMode;
    readonly scope: { guildId: string; channelId: string; userId: string };
    readonly historyAllowed: boolean;
  }): readonly CuratedStationItem[] {
    const dispatched: CuratedStationItem[] = [];
    for (const item of input.curated.slice(0, input.needed)) {
      const liveStation = input.session.station;
      if (liveStation === undefined || input.session.torndown) break;
      const liveSnapshot = input.session.actor.getSnapshot();
      if (
        snapshotStateName(liveSnapshot) === "leaving" ||
        liveSnapshot.context.queue.length >= STATION_LOW_WATER
      ) {
        break;
      }
      const source = withMode(item.source, input.mode);
      const identity = sourceIdentity(source);
      const requestId = recordStationHistoryRequest({
        history: this.deps.history,
        historyAllowed: input.historyAllowed,
        scope: input.scope,
        station: liveStation,
        source,
        item,
      });
      input.session.station = {
        ...liveStation,
        recentIdentities: appendStationRingBuffer(
          liveStation.recentIdentities,
          identity,
          MAX_STATION_RECENT_IDENTITIES,
        ),
      };
      input.session.actor.send({
        type: "ADD",
        source,
        requesterId: liveStation.ownerId,
        queuedAt: Date.now(),
        display: {
          title: item.title,
          ...(item.thumbnailUrl === undefined
            ? {}
            : { thumbnailUrl: item.thumbnailUrl }),
        },
        ...(requestId === undefined ? {} : { requestId }),
      });
      dispatched.push({ ...item, source });
    }
    if (dispatched.length > 0) {
      void this.deps.saveSnapshot?.(input.session);
    }
    return dispatched;
  }

  private async resolveStationMediaMode(
    session: StationSessionTarget,
    station: PersistedStation,
  ): Promise<MediaMode> {
    if (session.playbackChannel !== undefined) {
      return playbackTransport(session.playbackChannel);
    }
    if (station.kind === "tv" || this.deps.featureGate === undefined) {
      return station.kind === "tv" ? "video" : "music";
    }
    const overVoice = await this.deps.featureGate.musicOverVoice({
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      userId: station.ownerId,
    });
    return overVoice ? "music" : "video";
  }
}
