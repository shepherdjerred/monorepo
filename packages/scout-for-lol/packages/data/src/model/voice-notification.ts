import { z } from "zod";

// ============================================================================
// Voice Notification System - Branded ID Types
// ============================================================================

// Note: User model uses DiscordAccountId as primary key (from discord.ts)

export type ApiTokenId = z.infer<typeof ApiTokenIdSchema>;
export const ApiTokenIdSchema = z.number().int().positive().brand("ApiTokenId");

export type SoundPackId = z.infer<typeof SoundPackIdSchema>;
export const SoundPackIdSchema = z
  .number()
  .int()
  .positive()
  .brand("SoundPackId");

export type DesktopClientId = z.infer<typeof DesktopClientIdSchema>;
export const DesktopClientIdSchema = z
  .number()
  .int()
  .positive()
  .brand("DesktopClientId");

export type StoredSoundId = z.infer<typeof StoredSoundIdSchema>;
export const StoredSoundIdSchema = z
  .number()
  .int()
  .positive()
  .brand("StoredSoundId");

export type GameEventLogId = z.infer<typeof GameEventLogIdSchema>;
export const GameEventLogIdSchema = z
  .number()
  .int()
  .positive()
  .brand("GameEventLogId");
