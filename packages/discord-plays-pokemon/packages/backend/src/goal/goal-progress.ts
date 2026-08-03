// Per-goal deterministic status floor: tracks what the run has been doing and
// posts a synthesized audience update when nothing else was published within
// the configured interval. Split from GoalManager (like spawn-goal-codex.ts)
// to keep that file under the max-lines lint cap.

import { logger } from "#src/logger.ts";
import { goalProgressUpdatesTotal } from "#src/observability/metrics.ts";
import type { SpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import { formatLocationLine } from "./game-state-summary.ts";
import { GoalActivityLog } from "./goal-activity.ts";
import { sanitizeDiscordText, truncateForDiscord } from "./discord-message.ts";
import type { GoalMessageSender, GoalState } from "./goal-types.ts";

const MILESTONE_MAX_CHARS = 300;

/** The slice of ActiveGoal that tick() reads and mutates. */
export type IntervalTickTarget = {
  state: GoalState;
  lastProgressSentAt: number;
};

export type GoalIntervalReporterOptions = {
  updateIntervalSeconds: number;
  progressUpdateIntervalSeconds: number;
  sendMessage: GoalMessageSender;
  now: () => number;
  spatialSnapshot: () => SpatialSnapshot | null;
};

export class GoalIntervalReporter {
  readonly activity = new GoalActivityLog();
  private lastIntervalCheckAt: number;
  // Milestones arriving before the goal is active (the stdout pump starts at
  // spawn, before GoalManager.active is set) buffer here; activate() drains
  // them through the forwarder. Undefined once active.
  private pendingMilestones: string[] | undefined = [];
  private forward: ((text: string) => void) | undefined;

  constructor(private readonly options: GoalIntervalReporterOptions) {
    this.lastIntervalCheckAt = options.now();
  }

  // Arrow property so it can be passed as a bare callback to spawnGoalCodex.
  readonly onAgentMessage = (text: string): void => {
    this.activity.noteAgentMessage(text);
    if (this.pendingMilestones !== undefined) {
      this.pendingMilestones.push(text);
      return;
    }
    this.forward?.(text);
  };

  /** Start forwarding milestones (and drain any buffered ones). */
  activate(forward: (text: string) => void): void {
    this.forward = forward;
    const pending = this.pendingMilestones ?? [];
    this.pendingMilestones = undefined;
    for (const text of pending) {
      forward(text);
    }
  }

  recordToolCall(
    entry: Readonly<{ method: string; path: string; status: number }>,
  ): void {
    this.activity.record({ ...entry, at: this.options.now() });
  }

  /**
   * Model-authored narration (the agent's explicit /progress call or a
   * forwarded agent_message). Throttled by progressUpdateIntervalSeconds,
   * deduped against the last posted text (a forwarded milestone and the
   * agent's own /progress often carry identical text), persisted as
   * state.lastProgress. Posted verbatim with no mention/prefix — mid-session
   * updates are audience-facing narration for the livestream, not a reply to
   * the requester (sanitizeDiscordText still defangs any @ the model emits;
   * allowedUserIds is empty so nobody is pinged).
   */
  async publishProgress(
    active: IntervalTickTarget,
    message: string,
    source: "agent" | "milestone",
    persist: () => Promise<void>,
  ): Promise<boolean> {
    const trimmed = message.trim();
    if (trimmed.length === 0 || trimmed === active.state.lastProgress) {
      return false;
    }
    const now = this.options.now();
    const minimumDelay = this.options.progressUpdateIntervalSeconds * 1000;
    if (now - active.lastProgressSentAt < minimumDelay) {
      return false;
    }
    active.lastProgressSentAt = now;
    active.state.lastProgress = trimmed;
    await persist();
    await this.options.sendMessage({
      channelId: active.state.channelId,
      content: truncateForDiscord(sanitizeDiscordText(trimmed)),
      allowedUserIds: [],
    });
    goalProgressUpdatesTotal.inc({ source });
    return true;
  }

  /**
   * Fired by the per-goal timer. Posts a synthesized status line unless
   * something else (agent /progress or a forwarded milestone) was published
   * within the interval. Deliberately bypasses the publishProgress throttle —
   * it enforces its own floor against the same lastProgressSentAt clock, so
   * no configuration can silence updates entirely and the combined outbound
   * rate stays bounded. Does not touch state.lastProgress or persistence:
   * synthetic status is not model narration. Posts a truthful "no new
   * actions" line when idle — that silence IS the stuck signal.
   */
  async tick(active: IntervalTickTarget): Promise<void> {
    const now = this.options.now();
    const since = this.lastIntervalCheckAt;
    this.lastIntervalCheckAt = now;
    const intervalMs = this.options.updateIntervalSeconds * 1000;
    if (now - active.lastProgressSentAt < intervalMs) {
      return;
    }
    const content = this.compose(active.state.lastProgress, since, now);
    active.lastProgressSentAt = now;
    try {
      await this.options.sendMessage({
        channelId: active.state.channelId,
        content: truncateForDiscord(sanitizeDiscordText(content)),
        allowedUserIds: [],
      });
      goalProgressUpdatesTotal.inc({ source: "interval" });
    } catch (error) {
      logger.warn(
        `goal interval update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private compose(
    fallbackMilestone: string | undefined,
    since: number,
    now: number,
  ): string {
    const lines: string[] = [];
    const spatial = this.options.spatialSnapshot();
    if (spatial !== null) {
      lines.push(formatLocationLine(spatial));
    }
    const windowSeconds = Math.max(1, Math.round((now - since) / 1000));
    const actions = this.activity.summarizeSince(since);
    lines.push(
      actions === undefined
        ? `No new actions in the last ${String(windowSeconds)}s.`
        : `Last ${String(windowSeconds)}s: ${actions}.`,
    );
    const milestone = this.activity.lastAgentMessage() ?? fallbackMilestone;
    if (milestone !== undefined) {
      lines.push(
        milestone.length > MILESTONE_MAX_CHARS
          ? `${milestone.slice(0, MILESTONE_MAX_CHARS)}…`
          : milestone,
      );
    }
    return lines.join("\n");
  }
}
