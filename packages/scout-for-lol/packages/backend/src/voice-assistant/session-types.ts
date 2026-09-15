import type { CompletedVoiceTurn } from "@shepherdjerred/voice-assistant";
import type { StartedVoiceExplore } from "#src/voice-assistant/explore-adapter.ts";

export type VoiceTurn = Pick<
  CompletedVoiceTurn,
  "userId" | "pcm16k" | "activatedAtMs" | "followUp"
>;

export type TurnAudioClock = {
  firstAudioAtMs: () => number | undefined;
  markFirstAudio: () => void;
};

export type BackgroundCompletionInput = {
  started: Promise<StartedVoiceExplore>;
  userId: string;
  usedFollowUp: boolean;
  activatedAtMs: number;
  firstAudioAtMs: () => number | undefined;
  markFirstAudio: () => void;
};
