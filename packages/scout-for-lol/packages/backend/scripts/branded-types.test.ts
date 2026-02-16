/**
 * Compile-time type tests for Prisma branded types
 *
 * These tests verify that Prisma's generated types use branded IDs correctly.
 * All tests are compile-time only - no runtime behavior.
 *
 * Based on: https://frontendmasters.com/blog/testing-types-in-typescript/
 */

import type {
  Player,
  Account,
  Competition,
  CompetitionParticipant,
} from "packages/backend/generated/prisma/client/index.js";
import type {
  PlayerId,
  CompetitionId,
  AccountId,
  ParticipantId,
  DiscordGuildId,
  DiscordChannelId,
  DiscordAccountId,
} from "@scout-for-lol/data";

// ============================================================================
// Type Testing Utilities
// ============================================================================

/**
 * Expects true - fails at compile time if not true
 */
type Expect<T extends true> = T;

/**
 * Inverts a false to true - used for negative assertions
 */
// @ts-expect-error - type is intentionally unused
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Type helper for compile-time assertions
type Not<T extends false> = true;

/**
 * Check if two types are mutually assignable (works with branded types)
 * Branded types are intersection types like: number & { __brand: "PlayerId" }
 * We check if they're mutually assignable, wrapped in tuples to prevent union distribution
 */
type TypesMatch<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

// ============================================================================
// Tests: Player Model Returns Branded Types
// ============================================================================

// Player.id should be PlayerId
type PlayerIdIsBranded = Expect<TypesMatch<Player["id"], PlayerId>>;

// Player should have PlayerId, not plain number
type PlayerIdNotPlainNumber = Expect<Not<TypesMatch<Player["id"], number>>>;

// ============================================================================
// Tests: Account Model Returns Branded Types
// ============================================================================

// Account.id should be AccountId
type AccountIdIsBranded = Expect<TypesMatch<Account["id"], AccountId>>;

// Account.playerId should be PlayerId
type AccountPlayerIdIsBranded = Expect<TypesMatch<Account["playerId"], PlayerId>>;

// Account should not have plain numbers
type AccountIdNotPlainNumber = Expect<Not<TypesMatch<Account["id"], number>>>;
type AccountPlayerIdNotPlainNumber = Expect<Not<TypesMatch<Account["playerId"], number>>>;

// ============================================================================
// Tests: Competition Model Returns Branded Types
// ============================================================================

// Competition.id should be CompetitionId
type CompetitionIdIsBranded = Expect<TypesMatch<Competition["id"], CompetitionId>>;

// Competition should not have plain number id
type CompetitionIdNotPlainNumber = Expect<Not<TypesMatch<Competition["id"], number>>>;

// ============================================================================
// Tests: CompetitionParticipant Has Multiple Branded IDs
// ============================================================================

// CompetitionParticipant.id should be ParticipantId
type ParticipantIdIsBranded = Expect<TypesMatch<CompetitionParticipant["id"], ParticipantId>>;

// CompetitionParticipant.playerId should be PlayerId
type ParticipantPlayerIdIsBranded = Expect<TypesMatch<CompetitionParticipant["playerId"], PlayerId>>;

// CompetitionParticipant.competitionId should be CompetitionId
type ParticipantCompetitionIdIsBranded = Expect<TypesMatch<CompetitionParticipant["competitionId"], CompetitionId>>;

// ============================================================================
// Tests: Type Safety - Can't Mix Different ID Types
// ============================================================================

// PlayerId and CompetitionId should be different types
type PlayerIdAndCompetitionIdDifferent = Expect<Not<TypesMatch<PlayerId, CompetitionId>>>;

// PlayerId and AccountId should be different types
type PlayerIdAndAccountIdDifferent = Expect<Not<TypesMatch<PlayerId, AccountId>>>;

// CompetitionId and AccountId should be different types
type CompetitionIdAndAccountIdDifferent = Expect<Not<TypesMatch<CompetitionId, AccountId>>>;

// ============================================================================
// Tests: Discord ID Branded Types
// ============================================================================

// Competition.serverId should be DiscordGuildId
type CompetitionServerIdIsBranded = Expect<TypesMatch<Competition["serverId"], DiscordGuildId>>;

// Competition.channelId should be DiscordChannelId
type CompetitionChannelIdIsBranded = Expect<TypesMatch<Competition["channelId"], DiscordChannelId>>;

// Competition.ownerId should be DiscordAccountId
type CompetitionOwnerIdIsBranded = Expect<TypesMatch<Competition["ownerId"], DiscordAccountId>>;

// Player.serverId should be DiscordGuildId
type PlayerServerIdIsBranded = Expect<TypesMatch<Player["serverId"], DiscordGuildId>>;

// Player.discordId should be DiscordAccountId | null
type PlayerDiscordIdIsBranded = Expect<TypesMatch<Player["discordId"], DiscordAccountId | null>>;

// ============================================================================
// Tests: Branded Types Are Still Numbers at Runtime
// ============================================================================

// PlayerId should be assignable to number (it's a branded number)
type PlayerIdIsNumber = [PlayerId] extends [number] ? true : false;
type PlayerIdExtendsNumber = Expect<PlayerIdIsNumber>;

// CompetitionId should be assignable to number
type CompetitionIdIsNumber = [CompetitionId] extends [number] ? true : false;
type CompetitionIdExtendsNumber = Expect<CompetitionIdIsNumber>;

// AccountId should be assignable to number
type AccountIdIsNumber = [AccountId] extends [number] ? true : false;
type AccountIdExtendsNumber = Expect<AccountIdIsNumber>;

// ============================================================================
// Tests: Function Parameters with Branded Types
// ============================================================================

/**
 * Example function that requires PlayerId
 */
type ProcessPlayerFn = (id: PlayerId) => void;

/**
 * Check that the function won't accept CompetitionId
 */
type ProcessPlayerDoesNotAcceptCompetitionId = Expect<Not<TypesMatch<Parameters<ProcessPlayerFn>, [CompetitionId]>>>;

/**
 * Check that the function accepts PlayerId
 */
type ProcessPlayerAcceptsPlayerId = Expect<TypesMatch<Parameters<ProcessPlayerFn>, [PlayerId]>>;

// ============================================================================
// Summary: All Tests Collected Here
// ============================================================================

/**
 * All type tests in one place
 * If any test fails, TypeScript will error at compile time
 *
 * @ts-ignore - Unused type, but all members are still type-checked!
 */
type AllTests = [
  // Player model - numeric IDs
  PlayerIdIsBranded,
  PlayerIdNotPlainNumber,

  // Account model - numeric IDs
  AccountIdIsBranded,
  AccountPlayerIdIsBranded,
  AccountIdNotPlainNumber,
  AccountPlayerIdNotPlainNumber,

  // Competition model - numeric IDs
  CompetitionIdIsBranded,
  CompetitionIdNotPlainNumber,

  // CompetitionParticipant model - numeric IDs
  ParticipantIdIsBranded,
  ParticipantPlayerIdIsBranded,
  ParticipantCompetitionIdIsBranded,

  // Discord IDs (string-based branded types)
  CompetitionServerIdIsBranded,
  CompetitionChannelIdIsBranded,
  CompetitionOwnerIdIsBranded,
  PlayerServerIdIsBranded,
  PlayerDiscordIdIsBranded,

  // Type safety - can't mix different ID types
  PlayerIdAndCompetitionIdDifferent,
  PlayerIdAndAccountIdDifferent,
  CompetitionIdAndAccountIdDifferent,

  // Runtime compatibility - branded types are still primitives
  PlayerIdExtendsNumber,
  CompetitionIdExtendsNumber,
  AccountIdExtendsNumber,

  // Function parameters - enforce correct types
  ProcessPlayerDoesNotAcceptCompetitionId,
  ProcessPlayerAcceptsPlayerId,
];

// ============================================================================
// Export for Visibility
// ============================================================================

/**
 * Export to make this module (prevents "unused" warnings)
 */
export type { AllTests };
