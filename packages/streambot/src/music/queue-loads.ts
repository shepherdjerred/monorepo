import { MusicError } from "./errors.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { z } from "zod";
import type { QueueLoadSchema } from "./contracts.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

type Progress = z.infer<typeof QueueLoadSchema>;
type Load = {
  userId: string;
  guildId: string;
  channelId: string;
  slot: number | undefined;
  controller: AbortController;
  progress: Progress;
  updatedAt: number;
};
/** Request-scoped work only; completed queue entries, not imports, are durable. */
export class QueueLoads {
  private readonly loads = new Map<string, Load>();
  start(
    context: {
      userId: string;
      guildId: string;
      channelId: string;
      slot: number | undefined;
    },
    run: (
      signal: AbortSignal,
      progress: (count: number) => void,
    ) => Promise<{ count: number; complete: boolean | null; message: string }>,
    onEnd?: (progress: Progress) => Promise<void>,
  ): Progress {
    for (const [key, load] of this.loads)
      if (
        load.progress.state !== "loading" &&
        Date.now() - load.updatedAt > 15 * 60_000
      )
        this.loads.delete(key);
    const active = [...this.loads.values()].filter(
      (load) =>
        load.userId === context.userId && load.progress.state === "loading",
    );
    if (active.length >= 2 || this.loads.size >= 2000)
      throw new MusicError(
        429,
        "playlist_busy",
        "A playlist is already loading. Finish or cancel it first.",
      );
    const id = crypto.randomUUID();
    const load: Load = {
      ...context,
      controller: new AbortController(),
      updatedAt: Date.now(),
      progress: {
        id,
        state: "loading",
        count: 0,
        complete: null,
        message: "Loading playlist…",
      },
    };
    this.loads.set(id, load);
    void (async () => {
      const signal = AbortSignal.any([
        load.controller.signal,
        AbortSignal.timeout(5 * 60_000),
      ]);
      try {
        const result = await run(signal, (count) => {
          if (load.progress.state === "loading") {
            load.progress.count = count;
            load.progress.message =
              "Loading playlist… " + String(count) + " track(s) found.";
          }
        });
        signal.throwIfAborted();
        load.progress = { id, state: "ready", ...result };
      } catch (error) {
        load.progress.state = load.controller.signal.aborted
          ? "cancelled"
          : "failed";
        load.progress.message = load.controller.signal.aborted
          ? "Playlist loading cancelled. No additional tracks were queued."
          : error instanceof MusicError ||
              error instanceof PlaybackCommandBoundaryError
            ? error.message
            : "The playlist could not be loaded. Check the public link and try again.";
      } finally {
        load.updatedAt = Date.now();
        try {
          await onEnd?.({ ...load.progress });
        } catch {
          logger.warn("playlist completion reply could not be delivered");
        }
      }
    })();
    return { ...load.progress };
  }
  read(id: string, userId: string, guildId: string): Progress {
    const load = this.loads.get(id);
    if (load?.userId !== userId || load.guildId !== guildId)
      throw new MusicError(
        404,
        "load_missing",
        "This playlist request expired or was interrupted. Queue it again to retry.",
      );
    return { ...load.progress };
  }
  cancel(id: string, userId: string, guildId: string): Progress {
    this.read(id, userId, guildId);
    const load = this.loads.get(id);
    if (load?.progress.state === "loading") {
      load.controller.abort();
      load.progress.state = "cancelled";
      load.progress.message = "Playlist loading cancelled.";
    }
    return this.read(id, userId, guildId);
  }
  cancelRoom(guildId: string, channelId: string, slot?: number): void {
    for (const load of this.loads.values())
      if (
        load.guildId === guildId &&
        load.channelId === channelId &&
        (slot === undefined || slot === load.slot) &&
        load.progress.state === "loading"
      )
        load.controller.abort();
  }
  close(): void {
    for (const load of this.loads.values()) load.controller.abort();
    this.loads.clear();
  }
}
