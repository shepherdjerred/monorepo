/**
 * Voice Module
 *
 * Discord voice channel management and audio playback.
 */

import {
  VoiceManager as VoiceManagerImport,
  voiceManager as voiceManagerImport,
} from "@shepherdjerred/scout-backend/voice/voice-manager.ts";
import { getAudioStream as getAudioStreamImport } from "@shepherdjerred/scout-backend/voice/audio-player.ts";

/**
 * Manages voice connections and audio playback for Discord guilds
 */
// eslint-disable-next-line custom-rules/no-re-exports -- Module facade pattern for clean public API
export const VoiceManager = VoiceManagerImport;

/**
 * Singleton voice manager instance
 */
// eslint-disable-next-line custom-rules/no-re-exports -- Module facade pattern for clean public API
export const voiceManager = voiceManagerImport;

/**
 * Get an audio stream from a sound source
 */
// eslint-disable-next-line custom-rules/no-re-exports -- Module facade pattern for clean public API
export const getAudioStream = getAudioStreamImport;
