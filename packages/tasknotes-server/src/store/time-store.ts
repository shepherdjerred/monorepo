import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { TimeEntry, TimeSummary } from "../domain/types.ts";

const TimeEntryArraySchema = z.array(
  z.object({
    taskId: z.string(),
    startTime: z.string(),
    endTime: z.string().optional(),
    duration: z.number().optional(),
  }),
);

export class TimeStore {
  private entries: TimeEntry[] = [];
  private readonly filePath: string;

  constructor(vaultPath: string) {
    this.filePath = path.join(vaultPath, "_tasknotes", "time-tracking.json");
  }

  async init(): Promise<void> {
    try {
      const file = Bun.file(this.filePath);
      const raw = await file.text();
      const parsed: unknown = JSON.parse(raw);
      const validated = TimeEntryArraySchema.safeParse(parsed);
      if (validated.success) {
        this.entries = validated.data;
      }
    } catch {
      this.entries = [];
    }
  }

  private async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    await Bun.write(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  async startTracking(taskId: string): Promise<void> {
    await this.stopTracking(taskId);

    const entry: TimeEntry = {
      taskId,
      startTime: new Date().toISOString(),
    };
    this.entries.push(entry);
    await this.save();
  }

  async stopTracking(taskId: string): Promise<void> {
    const hasActive = this.entries.some(
      (e) => e.taskId === taskId && e.endTime === undefined,
    );
    if (!hasActive) return;

    this.entries = this.entries.map((e) => {
      if (e.taskId === taskId && e.endTime === undefined) {
        const endTime = new Date().toISOString();
        const duration =
          new Date(endTime).getTime() - new Date(e.startTime).getTime();
        return { ...e, endTime, duration };
      }
      return e;
    });
    await this.save();
  }

  getTaskEntries(taskId: string): TimeSummary {
    const taskEntries = this.entries.filter((e) => e.taskId === taskId);
    const totalTime = taskEntries.reduce(
      (sum, e) => sum + (e.duration ?? 0),
      0,
    );
    return { totalTime, entries: taskEntries };
  }

  getSummary(): TimeSummary {
    const totalTime = this.entries.reduce(
      (sum, e) => sum + (e.duration ?? 0),
      0,
    );
    return { totalTime, entries: this.entries };
  }
}
