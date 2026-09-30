import {
  normalizeTranscript,
  verifyWakeTranscript,
} from "@shepherdjerred/voice-assistant";
import { VOICE_WAKE_PREFIXES } from "#src/voice-assistant/constants.ts";

const FOLLOW_UP_WINDOW_MS = 15_000;
export const VOICE_FOLLOW_UP_LIMIT = 2;

type FollowUpState = { userId: string; expiresAt: number; remaining: number };
export type ResolvedVoiceCommand = { command: string; usedFollowUp: boolean };

/** Same-speaker, short-lived continuation state for one `/scout join`. */
export class VoiceFollowUpWindow {
  private state: FollowUpState | null = null;

  constructor(private readonly now: () => number) {}

  isAllowed(userId: string): boolean {
    const state = this.state;
    if (state === null) return false;
    if (state.expiresAt <= this.now() || state.remaining <= 0) {
      this.state = null;
      return false;
    }
    return state.userId === userId;
  }

  resolveTranscript(
    transcript: string,
    lifecycleFollowUp: boolean,
    userId: string,
  ): ResolvedVoiceCommand | null {
    const verified = verifyWakeTranscript(transcript, VOICE_WAKE_PREFIXES);
    if (verified !== null) {
      return { command: verified.command, usedFollowUp: false };
    }
    return !lifecycleFollowUp || !this.isAllowed(userId)
      ? null
      : { command: normalizeTranscript(transcript), usedFollowUp: true };
  }

  consume(userId: string, usedFollowUp: boolean): void {
    if (usedFollowUp && this.state?.userId === userId) {
      this.state.remaining -= 1;
      return;
    }
    this.state = null;
  }

  arm(userId: string, usedFollowUp: boolean): void {
    const remaining = usedFollowUp
      ? this.state?.userId === userId
        ? this.state.remaining
        : 0
      : VOICE_FOLLOW_UP_LIMIT;
    this.state =
      remaining <= 0
        ? null
        : {
            userId,
            remaining,
            expiresAt: this.now() + FOLLOW_UP_WINDOW_MS,
          };
  }
}
