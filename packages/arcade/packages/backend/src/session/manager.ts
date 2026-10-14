import path from "node:path";
import {
  DiscordIdSchema,
  games,
  type GameId,
  type SessionView,
} from "@arcade/common/catalog.ts";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot";
import type { UserbotProvider } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";
import { ensureSessionDir } from "@shepherdjerred/discord-stream-lifecycle/persistence/session-paths";
import { snapshotSaveDir } from "@shepherdjerred/discord-stream-lifecycle/persistence/save-history";
import type { SessionStopReason } from "@shepherdjerred/discord-stream-lifecycle/session/session";
import type {
  ArcadeSession,
  GameServerModule,
  GameSession,
} from "#src/games/module.ts";
import { Room } from "./room.ts";

type StartRequest = {
  gameId: GameId;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedByUserId: string;
};

export type StartResult =
  | { kind: "started"; session: SessionView }
  | { kind: "occupied" | "save-in-use"; session: SessionView }
  | {
      kind:
        "capacity" | "heavy-capacity" | "no-account" | "disabled" | "cancelled";
    }
  | { kind: "failed"; error: Error };

export type StopResult =
  | { kind: "stopped"; error: Error | undefined }
  | { kind: "not-active" }
  | { kind: "forbidden" };

type Entry<T extends PooledUserbot> = {
  session: ArcadeSession<T>;
  phase: SessionView["phase"];
  room: Room;
  controller: AbortController;
  ready: Promise<void>;
  markReady: () => void;
  runtime: GameSession | undefined;
  cleanup: Promise<Error | undefined> | undefined;
};

export class SessionManager<T extends PooledUserbot> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly rooms = new Map<string, Room>();
  private closing = false;
  private readonly lifecycleListeners = new Set<() => void>();

  onLifecycleChange(listener: () => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  constructor(
    private readonly options: {
      pool: UserbotProvider<T>;
      modules: ReadonlyMap<GameId, GameServerModule<T>>;
      stateRoot: string;
      maxSessions: number;
      maxHeavySessions: number;
      changed: (guildId: string, gameId: GameId) => void;
      error: (error: Error) => void;
    },
  ) {}

  list(guildId?: string): SessionView[] {
    return [...this.entries.values()]
      .filter(
        (entry) => guildId === undefined || entry.session.guildId === guildId,
      )
      .map((entry) => this.view(entry));
  }

  room(guildId: string, gameId: GameId): Room {
    DiscordIdSchema.parse(guildId);
    const key = `${guildId}:${gameId}`;
    let room = this.rooms.get(key);
    if (room === undefined) {
      room = new Room(guildId, games[gameId], () => {
        this.options.changed(guildId, gameId);
      });
      this.rooms.set(key, room);
    }
    return room;
  }

  session(
    id: string,
  ):
    | { view: SessionView; room: Room; runtime: GameSession | undefined }
    | undefined {
    const entry = this.entries.get(id);
    return entry === undefined
      ? undefined
      : { view: this.view(entry), room: entry.room, runtime: entry.runtime };
  }

  async start(request: StartRequest): Promise<StartResult> {
    for (const id of [
      request.guildId,
      request.voiceChannelId,
      request.textChannelId,
      request.startedByUserId,
    ])
      DiscordIdSchema.parse(id);
    const module = this.options.modules.get(request.gameId);
    if (module === undefined || this.closing) return { kind: "disabled" };
    const conflict = this.reservationConflict(request, module.definition.heavy);
    if (conflict !== undefined) return conflict;
    const account = this.options.pool.acquire(request.guildId);
    if (account === null) return { kind: "no-account" };
    const { promise: ready, resolve: markReady } =
      Promise.withResolvers<undefined>();
    const entry: Entry<T> = {
      session: {
        ...request,
        id: crypto.randomUUID(),
        game: module.definition,
        userbotEntry: account,
        startedAt: new Date(),
        sessionDir: path.join(
          this.options.stateRoot,
          request.gameId,
          request.guildId,
        ),
      },
      phase: "starting",
      room: this.room(request.guildId, request.gameId),
      controller: new AbortController(),
      ready,
      markReady: () => {
        markReady(undefined);
      },
      runtime: undefined,
      cleanup: undefined,
    };
    // Reserve synchronously before the first await, including accounts and saves.
    this.entries.set(entry.session.id, entry);
    try {
      this.publish(entry);
      await ensureSessionDir(
        path.join(this.options.stateRoot, request.gameId),
        request.guildId,
      );
      entry.controller.signal.throwIfAborted();
      await snapshotSaveDir(entry.session.sessionDir, {
        entries: module.saveEntries,
        keep: 50,
      });
      entry.controller.signal.throwIfAborted();
      entry.runtime = module.create({
        session: entry.session,
        players: () => entry.room.players(),
        publishState: (state) => {
          entry.room.publishState(entry.session.id, state);
        },
        publishEvent: (event) => {
          entry.room.publishEvent(entry.session.id, event);
        },
        reportError: (error) => {
          entry.room.reportError(entry.session.id, error);
          this.options.error(error);
        },
        fatalError: (error) => {
          void (async () => {
            try {
              await this.stopForSystem(entry.session.id, "error");
            } catch (stopError) {
              this.options.error(toError(stopError));
            }
          })();
          entry.room.reportError(entry.session.id, error);
          this.options.error(error);
        },
      });
      entry.room.setControls(entry.session.id, entry.runtime);
      await entry.runtime.start(entry.controller.signal);
      entry.controller.signal.throwIfAborted();
      entry.phase = "running";
      this.publish(entry);
      return { kind: "started", session: this.view(entry) };
    } catch (error) {
      const cancelled = entry.controller.signal.aborted;
      const failure = toError(error);
      try {
        entry.room.reportError(entry.session.id, failure);
      } finally {
        await this.finish(entry, "error");
      }
      return cancelled
        ? { kind: "cancelled" }
        : { kind: "failed", error: failure };
    } finally {
      entry.markReady();
    }
  }

  async stop(
    id: string,
    actor: { userId: string; moderator: boolean },
  ): Promise<StopResult> {
    const entry = this.entries.get(id);
    if (entry === undefined) return { kind: "not-active" };
    return entry.session.startedByUserId !== actor.userId && !actor.moderator
      ? { kind: "forbidden" }
      : this.stopEntry(entry, "userStop");
  }

  async stopForSystem(
    id: string,
    reason: SessionStopReason,
  ): Promise<StopResult> {
    const entry = this.entries.get(id);
    return entry === undefined
      ? { kind: "not-active" }
      : this.stopEntry(entry, reason);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    const results = await Promise.allSettled(
      [...this.entries.values()].map((entry) =>
        this.stopEntry(entry, "shutdown"),
      ),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected"
        ? [toError(result.reason)]
        : result.value.error === undefined
          ? []
          : [result.value.error],
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        "Arcade sessions failed to shut down cleanly",
      );
  }

  private async stopEntry(
    entry: Entry<T>,
    reason: SessionStopReason,
  ): Promise<Extract<StopResult, { kind: "stopped" }>> {
    entry.phase = "stopping";
    entry.controller.abort();
    const failures: Error[] = [];
    for (const action of [
      () => {
        entry.room.clearAllInput();
      },
      () => {
        this.publish(entry);
      },
    ]) {
      try {
        action();
      } catch (error) {
        failures.push(toError(error));
      }
    }
    await entry.ready;
    const failure = await this.finish(entry, reason);
    if (failure !== undefined) failures.push(failure);
    return { kind: "stopped", error: combinedFailure(failures) };
  }

  private finish(
    entry: Entry<T>,
    reason: SessionStopReason,
  ): Promise<Error | undefined> {
    entry.cleanup ??= this.cleanup(entry, reason);
    return entry.cleanup;
  }

  private async cleanup(
    entry: Entry<T>,
    reason: SessionStopReason,
  ): Promise<Error | undefined> {
    const failures: Error[] = [];
    try {
      await entry.runtime?.stop(reason);
    } catch (error) {
      const failure = toError(error);
      failures.push(failure);
      try {
        entry.room.reportError(entry.session.id, failure);
      } catch (notificationError) {
        failures.push(toError(notificationError));
      }
    } finally {
      this.entries.delete(entry.session.id);
      try {
        entry.room.end(entry.session.id);
      } catch (error) {
        failures.push(toError(error));
      } finally {
        this.options.pool.release(entry.session.userbotEntry);
        this.lifecycleChanged();
      }
    }
    const failure = combinedFailure(failures);
    if (failure !== undefined) this.options.error(failure);
    return failure;
  }

  private publish(entry: Entry<T>): void {
    entry.room.setSession(this.view(entry));
    this.lifecycleChanged();
  }

  private lifecycleChanged(): void {
    for (const listener of this.lifecycleListeners) listener();
  }

  private view(entry: Entry<T>): SessionView {
    const session = entry.session;
    return {
      id: session.id,
      gameId: session.game.id,
      guildId: session.guildId,
      voiceChannelId: session.voiceChannelId,
      startedByUserId: session.startedByUserId,
      startedAt: session.startedAt.toISOString(),
      phase: entry.phase,
    };
  }
  private reservationConflict(
    request: StartRequest,
    heavy: boolean,
  ): StartResult | undefined {
    for (const entry of this.entries.values()) {
      if (entry.session.guildId !== request.guildId) continue;
      if (entry.session.voiceChannelId === request.voiceChannelId)
        return { kind: "occupied", session: this.view(entry) };
      if (entry.session.game.id === request.gameId)
        return { kind: "save-in-use", session: this.view(entry) };
    }
    if (this.entries.size >= this.options.maxSessions)
      return { kind: "capacity" };
    return heavy &&
      [...this.entries.values()].filter((entry) => entry.session.game.heavy)
        .length >= this.options.maxHeavySessions
      ? { kind: "heavy-capacity" }
      : undefined;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function combinedFailure(failures: Error[]): Error | undefined {
  return failures.length > 1
    ? new AggregateError(failures, "Arcade session teardown failed")
    : failures[0];
}
