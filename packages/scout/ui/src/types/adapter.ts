/**
 * Sound Pack Adapter Types
 *
 * Defines the interface between the shared UI components and platform-specific
 * implementations (Tauri desktop app, web frontend, etc.)
 */

import type { SoundPack, SoundSource } from "@shepherdjerred/scout-data";

/**
 * Champion data for autocomplete
 */
export type Champion = {
  /** Champion ID (e.g., "Aatrox") */
  id: string;
  /** Display name (e.g., "Aatrox") */
  name: string;
};

/**
 * Status of a YouTube audio cache
 */
export type CacheStatus = "cached" | "caching" | "not-cached" | "error";

/**
 * Local player information
 */
export type LocalPlayer = {
  /** Summoner name */
  summonerName: string;
};

/**
 * Adapter interface for platform-specific operations
 *
 * The UI components use this adapter to perform operations that differ
 * between platforms (desktop app vs web).
 */
export type SoundPackAdapter = {
  // =========================================================================
  // File Operations
  // =========================================================================

  /**
   * Opens a file picker for selecting an audio file
   * @returns Path or URL to the selected file, or null if cancelled
   */
  selectAudioFile: () => Promise<string | null>;

  // =========================================================================
  // Sound Preview
  // =========================================================================

  /**
   * Plays a sound for preview
   * @param source The sound source to play
   */
  playSound: (source: SoundSource) => Promise<void>;

  /**
   * Stops any currently playing preview sound
   */
  stopSound: () => void;

  // =========================================================================
  // YouTube Caching
  // =========================================================================

  /**
   * Triggers caching of a YouTube URL
   * @param url The YouTube URL to cache
   * @returns Information about the cached file
   */
  cacheYouTubeAudio: (url: string) => Promise<{ cachedPath: string }>;

  /**
   * Gets the cache status for a YouTube URL
   * @param url The YouTube URL to check
   */
  getCacheStatus: (url: string) => Promise<CacheStatus>;

  // =========================================================================
  // Import/Export
  // =========================================================================

  /**
   * Exports a sound pack to a JSON file
   * @param pack The sound pack to export
   */
  exportSoundPack: (pack: SoundPack) => Promise<void>;

  /**
   * Opens a file picker to import a sound pack from JSON
   * @returns The imported sound pack, or null if cancelled
   */
  importSoundPack: () => Promise<SoundPack | null>;

  // =========================================================================
  // Data Sources
  // =========================================================================

  /**
   * Gets the list of all champions for autocomplete
   */
  getChampions: () => Promise<Champion[]>;

  /**
   * Gets the local player's information (if available)
   * Only works during an active game in the desktop app
   */
  getLocalPlayer: () => Promise<LocalPlayer | null>;

  // =========================================================================
  // Persistence
  // =========================================================================

  /**
   * Saves the sound pack to persistent storage
   * @param pack The sound pack to save
   */
  saveSoundPack: (pack: SoundPack) => Promise<void>;

  /**
   * Loads the sound pack from persistent storage
   * @returns The loaded sound pack, or null if none exists
   */
  loadSoundPack: () => Promise<SoundPack | null>;
};
