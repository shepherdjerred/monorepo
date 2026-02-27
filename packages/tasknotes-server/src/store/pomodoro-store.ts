import type { PomodoroStatus } from "../domain/types.ts";

const WORK_DURATION_MS = 25 * 60 * 1000;
const BREAK_DURATION_MS = 5 * 60 * 1000;

export class PomodoroStore {
  private active = false;
  private taskId: string | undefined;
  private type: "work" | "break" = "work";
  private startedAt = 0;
  private durationMs = WORK_DURATION_MS;
  private pausedRemaining: number | undefined;

  start(taskId?: string): PomodoroStatus {
    this.active = true;
    this.taskId = taskId;
    this.type = "work";
    this.durationMs = WORK_DURATION_MS;
    this.startedAt = Date.now();
    this.pausedRemaining = undefined;
    return this.getStatus();
  }

  stop(): PomodoroStatus {
    this.active = false;
    this.taskId = undefined;
    this.pausedRemaining = undefined;
    return this.getStatus();
  }

  pause(): PomodoroStatus {
    if (!this.active) return this.getStatus();

    if (this.pausedRemaining === undefined) {
      const elapsed = Date.now() - this.startedAt;
      this.pausedRemaining = Math.max(0, this.durationMs - elapsed);
    } else {
      this.startedAt = Date.now();
      this.durationMs = this.pausedRemaining;
      this.pausedRemaining = undefined;
    }

    return this.getStatus();
  }

  getStatus(): PomodoroStatus {
    if (!this.active) {
      return { active: false };
    }

    let timeRemaining: number;
    if (this.pausedRemaining === undefined) {
      const elapsed = Date.now() - this.startedAt;
      timeRemaining = Math.max(0, this.durationMs - elapsed);

      if (timeRemaining === 0) {
        if (this.type === "work") {
          this.type = "break";
          this.durationMs = BREAK_DURATION_MS;
          this.startedAt = Date.now();
          timeRemaining = BREAK_DURATION_MS;
        } else {
          this.active = false;
          return { active: false };
        }
      }
    } else {
      timeRemaining = this.pausedRemaining;
    }

    return {
      active: true,
      taskId: this.taskId,
      timeRemaining: Math.round(timeRemaining / 1000),
      type: this.type,
    };
  }
}
