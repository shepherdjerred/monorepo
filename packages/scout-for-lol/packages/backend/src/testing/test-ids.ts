/**
 * Test ID Utilities
 *
 * Centralized utilities for generating valid test IDs for Discord, League of Legends, etc.
 * All Discord IDs must be numeric strings (snowflake format) between 17-20 characters.
 */

import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";

/**
 * Zod schema for numeric-only identifiers (for Discord IDs)
 * Rejects any non-digit characters to prevent silent ID collisions
 */
const NumericIdentifierSchema = z.string().regex(/^\d+$/, {
  message:
    "Test ID identifier must contain only digits. Invalid characters will cause ID collisions.",
});

/**
 * Creates a valid Discord Guild ID (server ID)
 * Discord snowflake IDs are 17-20 numeric characters
 *
 * @param identifier - A unique numeric identifier (digits only)
 * @returns A valid DiscordGuildId
 * @throws ZodError if identifier contains non-digit characters
 *
 * @example
 * ```ts
 * const serverId = testGuildId("123");           // "312300000000000000" ✓
 * const serverId2 = testGuildId("1000000001");   // "310000000010000000" ✓
 * const serverId3 = testGuildId("test-server");  // throws ZodError ✗
 * ```
 */
export function testGuildId(identifier = "0"): DiscordGuildId {
  const validatedIdentifier = NumericIdentifierSchema.parse(identifier);
  const withPrefix = `3${validatedIdentifier}`;
  // Ensure length is between 17-20, truncate or pad as needed
  const numericId =
    withPrefix.length > 20
      ? withPrefix.slice(0, 20)
      : withPrefix.padEnd(18, "0");
  return DiscordGuildIdSchema.parse(numericId);
}

/**
 * Creates a valid Discord Account ID (user ID)
 * Discord snowflake IDs are 17-18 numeric characters
 *
 * @param identifier - A unique numeric identifier (digits only)
 * @returns A valid DiscordAccountId
 * @throws ZodError if identifier contains non-digit characters
 *
 * @example
 * ```ts
 * const userId = testAccountId("456");         // "245600000000000000" ✓
 * const userId2 = testAccountId("1000000001"); // "210000000010000000" ✓
 * const userId3 = testAccountId("owner");      // throws ZodError ✗
 * ```
 */
export function testAccountId(identifier = "0"): DiscordAccountId {
  const validatedIdentifier = NumericIdentifierSchema.parse(identifier);
  const withPrefix = `2${validatedIdentifier}`;
  // Ensure length is between 17-18, truncate or pad as needed
  const numericId =
    withPrefix.length > 18
      ? withPrefix.slice(0, 18)
      : withPrefix.padEnd(18, "0");
  return DiscordAccountIdSchema.parse(numericId);
}

/**
 * Creates a valid Discord Channel ID
 * Discord snowflake IDs are 17-20 numeric characters
 *
 * @param identifier - A unique numeric identifier (digits only)
 * @returns A valid DiscordChannelId
 * @throws ZodError if identifier contains non-digit characters
 *
 * @example
 * ```ts
 * const channelId = testChannelId("789");      // "178900000000000000" ✓
 * const channelId2 = testChannelId("1001");    // "110010000000000000" ✓
 * const channelId3 = testChannelId("general"); // throws ZodError ✗
 * ```
 */
export function testChannelId(identifier = "0"): DiscordChannelId {
  const validatedIdentifier = NumericIdentifierSchema.parse(identifier);
  const withPrefix = `1${validatedIdentifier}`;
  // Ensure length is between 17-20, truncate or pad as needed
  const numericId =
    withPrefix.length > 20
      ? withPrefix.slice(0, 20)
      : withPrefix.padEnd(18, "0");
  return DiscordChannelIdSchema.parse(numericId);
}

/**
 * Creates a valid League of Legends PUUID
 * PUUIDs are exactly 78 alphanumeric characters
 *
 * @param identifier - A unique identifier for this PUUID
 * @returns A valid LeaguePuuid
 *
 * @example
 * ```ts
 * const puuid = testPuuid("main-account");
 * const puuid2 = testPuuid("smurf");
 * ```
 */
export function testPuuid(identifier: string): LeaguePuuid {
  // Use a mix of padding to avoid collisions when using numeric identifiers
  // e.g., "1" and "10" won't collide because we pad with "x" then "0"
  const base = `puuid-${identifier}`;
  const paddingNeeded = 78 - base.length;

  // First half with 'x', second half with '0' to create unique patterns
  const halfPadding = Math.floor(paddingNeeded / 2);
  const padding =
    "x".repeat(halfPadding) + "0".repeat(paddingNeeded - halfPadding);

  return LeaguePuuidSchema.parse(base + padding);
}
