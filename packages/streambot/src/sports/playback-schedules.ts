import { Database } from "bun:sqlite";
import { z } from "zod";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import {
  PlaybackScheduleSchema,
  ScheduleTargetSchema,
  type PlaybackSchedule,
  type ScheduleTarget,
} from "./schedule-types.ts";
import { lolSportsEvent, type LolEsportsClient } from "./lolesports.ts";
import type { SportsEvent } from "./types.ts";

export type SchedulePorts = {
  allowed: (target: ScheduleTarget) => Promise<boolean>;
  authority: (
    target: ScheduleTarget,
  ) => Promise<{ allowed: boolean; listeners: boolean }>;
  slot: (target: ScheduleTarget) => { idle: boolean; scheduleId?: string };
  start: (
    schedule: PlaybackSchedule,
    signal: AbortSignal,
    claim: () => boolean,
  ) => Promise<"started" | "capacity" | "busy">;
  stop: (schedule: PlaybackSchedule) => void;
};

/** Temporal drives reconciliation; this store never starts a process-local timer. */
export class LolPlaybackSchedules {
  private readonly db: Database;
  private running = false;
  constructor(
    file: string,
    private readonly lol: Pick<LolEsportsClient, "find">,
    private readonly ports: SchedulePorts,
  ) {
    this.db = new Database(file, { create: true, strict: true });
    this.db.run(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS lol_schedules (id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, payload TEXT NOT NULL)",
    );
  }
  close() {
    this.db.close();
  }
  private all(): PlaybackSchedule[] {
    return this.db
      .query("SELECT payload FROM lol_schedules ORDER BY rowid")
      .all()
      .map((row) =>
        PlaybackScheduleSchema.parse(
          JSON.parse(z.object({ payload: z.string() }).parse(row).payload),
        ),
      );
  }
  private save(schedule: PlaybackSchedule) {
    this.db
      .query("UPDATE lol_schedules SET payload=?2 WHERE id=?1")
      .run(schedule.id, JSON.stringify(schedule));
  }
  list(guildId: string, userId: string) {
    return this.all()
      .filter((s) => s.target.guildId === guildId && s.target.userId === userId)
      .map((s) => ({
        id: s.id,
        title: s.event.title,
        startsAt: s.event.startsAt,
        status: s.status,
        reason: s.reason,
        slot: s.target.slot,
        channelId: s.target.channelId,
        channelName: s.target.channelName,
      }));
  }
  async create(
    event: SportsEvent,
    rawTarget: ScheduleTarget,
    signal: AbortSignal,
  ) {
    if (rawTarget.slot === 1)
      throw new PlaybackCommandBoundaryError(
        "Scheduled sports need a video channel. Choose channel 2 or higher.",
      );
    const target = ScheduleTargetSchema.parse(rawTarget);
    const authority = await this.ports.authority(target);
    if (!(await this.ports.allowed(target)) || !authority.allowed)
      throw new PlaybackCommandBoundaryError(
        "You cannot schedule playback in that channel.",
      );
    if (event.lol === undefined || event.provider !== "lolesports")
      throw new PlaybackCommandBoundaryError("Choose an upcoming LoL series.");
    const fresh = await this.lol.find(event, signal);
    if (fresh?.state !== "unstarted")
      throw new PlaybackCommandBoundaryError(
        "This series is no longer upcoming. Refresh the schedule.",
      );
    const identity = [
      target.guildId,
      target.channelId,
      target.slot,
      event.id,
    ].join(":");
    const existing = this.db
      .query("SELECT payload FROM lol_schedules WHERE identity=?1")
      .get(identity);
    if (existing !== null) {
      const previous = PlaybackScheduleSchema.parse(
        JSON.parse(z.object({ payload: z.string() }).parse(existing).payload),
      );
      if (["pending", "starting", "playing"].includes(previous.status)) {
        if (previous.target.userId !== target.userId)
          throw new PlaybackCommandBoundaryError(
            "This series is already scheduled in that video slot.",
          );
        return previous;
      }
      // Retain terminal history while freeing the active deduplication key.
      this.db
        .query("UPDATE lol_schedules SET identity=?2 WHERE id=?1")
        .run(previous.id, `${identity}:terminal:${previous.id}`);
    }
    const schedule: PlaybackSchedule = {
      id: crypto.randomUUID(),
      target,
      event: lolSportsEvent(fresh),
      status: "pending",
      reason: "waiting",
      createdAt: Date.now(),
    };
    this.db
      .query("INSERT INTO lol_schedules VALUES (?1,?2,?3)")
      .run(schedule.id, identity, JSON.stringify(schedule));
    return schedule;
  }
  cancel(id: string, guildId: string, userId: string) {
    const schedule = this.all().find(
      (s) =>
        s.id === id &&
        s.target.guildId === guildId &&
        s.target.userId === userId,
    );
    if (schedule === undefined)
      throw new PlaybackCommandBoundaryError("That schedule is unavailable.");
    if (this.ports.slot(schedule.target).scheduleId === id)
      this.ports.stop(schedule);
    this.save({ ...schedule, status: "cancelled", reason: "none" });
  }
  async reconcile(signal: AbortSignal) {
    if (this.running) return;
    this.running = true;
    try {
      for (const schedule of this.all().filter((s) =>
        ["pending", "starting", "playing"].includes(s.status),
      )) {
        signal.throwIfAborted();
        try {
          await this.reconcileOne(schedule, signal);
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof PlaybackCommandBoundaryError)) throw error;
          const current = this.active(schedule.id);
          if (current?.status === "pending")
            this.save({ ...current, reason: "broadcast" });
        }
      }
    } finally {
      this.running = false;
    }
  }
  private active(id: string) {
    return this.all().find((s) => s.id === id);
  }
  private update(
    schedule: PlaybackSchedule,
    status: PlaybackSchedule["status"],
    reason: PlaybackSchedule["reason"],
  ) {
    if (this.active(schedule.id)?.status !== "cancelled")
      this.save({ ...schedule, status, reason });
  }
  private async reconcileOne(schedule: PlaybackSchedule, signal: AbortSignal) {
    const slot = this.ports.slot(schedule.target);
    const owns = slot.scheduleId === schedule.id;
    const update = (
      status: PlaybackSchedule["status"],
      reason: PlaybackSchedule["reason"],
    ) => {
      const current = this.active(schedule.id);
      if (current?.status === "cancelled") return;
      this.save({ ...schedule, status, reason });
    };
    if (!owns && schedule.status !== "pending") {
      update(
        schedule.status === "starting" ? "failed" : "stopped",
        schedule.status === "starting" ? "ambiguous" : "none",
      );
      return;
    }
    const match = await this.lol.find(schedule.event, signal);
    if (this.active(schedule.id)?.status === "cancelled") return;
    if (match === undefined) {
      update(schedule.status, "missing");
      return;
    }
    if (match.state === "completed" || match.state === "cancelled") {
      if (this.ports.slot(schedule.target).scheduleId === schedule.id)
        this.ports.stop(schedule);
      update("completed", "none");
      return;
    }
    schedule = { ...schedule, event: lolSportsEvent(match) };
    if (owns) {
      update("playing", "none");
      return;
    }
    await this.tryStart(schedule, signal);
  }

  private async tryStart(schedule: PlaybackSchedule, signal: AbortSignal) {
    const update = (
      status: PlaybackSchedule["status"],
      reason: PlaybackSchedule["reason"],
    ) => {
      this.update(schedule, status, reason);
    };
    if (!(await this.ports.allowed(schedule.target))) {
      update("failed", "disabled");
      return;
    }
    const authority = await this.ports.authority(schedule.target);
    if (!authority.allowed) {
      update("failed", "permission");
      return;
    }
    if (schedule.event.status !== "live") {
      update("pending", "waiting");
      return;
    }
    if (!authority.listeners) {
      update("pending", "listeners");
      return;
    }
    if (!this.ports.slot(schedule.target).idle) {
      update("pending", "busy");
      return;
    }
    const result = await this.ports.start(schedule, signal, () => {
      if (
        this.active(schedule.id)?.status !== "pending" ||
        !this.ports.slot(schedule.target).idle
      )
        return false;
      update("starting", "none");
      return true;
    });
    if (this.active(schedule.id)?.status === "cancelled") {
      if (this.ports.slot(schedule.target).scheduleId === schedule.id)
        this.ports.stop(schedule);
      return;
    }
    update(
      result === "started" ? "playing" : "pending",
      result === "started" ? "none" : result,
    );
  }
}
