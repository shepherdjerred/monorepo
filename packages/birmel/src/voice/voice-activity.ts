import { logger } from "../utils/index.js";

type VoiceActivityState = {
  isSpeaking: boolean;
  speakingStartedAt: number | null;
  silenceStartedAt: number | null;
};

const userStates = new Map<string, VoiceActivityState>();

const SILENCE_THRESHOLD_MS = 1500; // Consider speech ended after 1.5s silence
const MIN_SPEECH_DURATION_MS = 500; // Minimum speech duration to process

export function updateVoiceActivity(userId: string, isSpeaking: boolean): void {
  let state = userStates.get(userId);

  if (!state) {
    state = {
      isSpeaking: false,
      speakingStartedAt: null,
      silenceStartedAt: null,
    };
    userStates.set(userId, state);
  }

  const now = Date.now();

  if (isSpeaking && !state.isSpeaking) {
    // Started speaking
    state.isSpeaking = true;
    state.speakingStartedAt = now;
    state.silenceStartedAt = null;
    logger.debug("User started speaking", { userId });
  } else if (!isSpeaking && state.isSpeaking) {
    // Started being silent
    state.isSpeaking = false;
    state.silenceStartedAt = now;
    logger.debug("User stopped speaking", { userId });
  }
}

export function shouldProcessSpeech(userId: string): boolean {
  const state = userStates.get(userId);
  if (!state) return false;

  // Must have started speaking at some point
  if (state.speakingStartedAt === null) return false;

  // Must currently be silent
  if (state.isSpeaking) return false;

  // Must have been silent long enough
  if (state.silenceStartedAt === null) return false;

  const silenceDuration = Date.now() - state.silenceStartedAt;
  if (silenceDuration < SILENCE_THRESHOLD_MS) return false;

  // Must have spoken long enough
  const speechDuration = state.silenceStartedAt - state.speakingStartedAt;
  if (speechDuration < MIN_SPEECH_DURATION_MS) return false;

  return true;
}

export function resetVoiceActivity(userId: string): void {
  userStates.delete(userId);
}

export function getVoiceActivityState(userId: string): VoiceActivityState | null {
  return userStates.get(userId) ?? null;
}

export function isSpeaking(userId: string): boolean {
  return userStates.get(userId)?.isSpeaking ?? false;
}

export function getSpeechDurationMs(userId: string): number | null {
  const state = userStates.get(userId);
  if (state?.speakingStartedAt === null || state?.speakingStartedAt === undefined) return null;

  const endTime = state.silenceStartedAt ?? Date.now();
  return endTime - state.speakingStartedAt;
}

export function cleanupInactiveStates(maxInactiveMs: number): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [userId, state] of userStates.entries()) {
    const lastActivity = state.silenceStartedAt ?? (state.speakingStartedAt ?? 0);
    if (now - lastActivity > maxInactiveMs) {
      userStates.delete(userId);
      cleaned++;
    }
  }

  return cleaned;
}

export function clearAllStates(): void {
  userStates.clear();
}
