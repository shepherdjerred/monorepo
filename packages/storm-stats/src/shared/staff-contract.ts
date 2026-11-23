import { z } from "zod";
import {
  BounceCategorySchema,
  IsoTimestampSchema,
  NonNegFloatSchema,
  NonNegIntSchema,
  NullablePingSchema,
  PercentSchema,
  PlatformSchema,
  PlayerDirectoryRowSchema,
  PlayerUuidSchema,
  UuidSchema,
} from "./contract.ts";

export const StaffNetworkResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  countries: z.array(
    z.strictObject({
      countryCode: z.string(),
      countryName: z.string(),
      players: NonNegIntSchema,
      sharePercent: PercentSchema,
      pingAvgMs: NullablePingSchema,
    }),
  ),
  joinAddresses: z.array(
    z.strictObject({
      joinAddress: z.string(),
      players: NonNegIntSchema,
      sessions: NonNegIntSchema,
      lastSeenAt: IsoTimestampSchema,
    }),
  ),
});
export type StaffNetworkResponse = z.infer<typeof StaffNetworkResponseSchema>;

export const StaffBouncesResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  byCategory: z.array(
    z.strictObject({
      category: BounceCategorySchema,
      count: NonNegIntSchema,
      uniquePlayers: NonNegIntSchema,
    }),
  ),
  recentBounces: z.array(
    z.strictObject({
      eventId: UuidSchema,
      occurredAt: IsoTimestampSchema,
      playerUuid: PlayerUuidSchema.nullable(),
      playerName: z.string(),
      category: BounceCategorySchema,
      reason: z.string(),
      joinAddress: z.string().nullable(),
    }),
  ),
});
export type StaffBouncesResponse = z.infer<typeof StaffBouncesResponseSchema>;

export const StaffQuerySummarySchema = z.strictObject({
  matchedPlayers: NonNegIntSchema,
  totalConnectedHours: NonNegFloatSchema,
  totalActiveHours: NonNegFloatSchema,
  meanActiveHours: NonNegFloatSchema,
  totalSessions: NonNegIntSchema,
  regularCount: NonNegIntSchema,
  activeCount: NonNegIntSchema,
  irregularCount: NonNegIntSchema,
  inactiveCount: NonNegIntSchema,
});
export type StaffQuerySummary = z.infer<typeof StaffQuerySummarySchema>;

export const StaffQueryResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  summary: StaffQuerySummarySchema,
  players: z.array(PlayerDirectoryRowSchema),
});
export type StaffQueryResponse = z.infer<typeof StaffQueryResponseSchema>;

export const StaffPlayerOverlayResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  uuid: PlayerUuidSchema,
  name: z.string(),
  joinAddresses: z.array(
    z.strictObject({
      joinAddress: z.string(),
      sessions: NonNegIntSchema,
      lastUsedAt: IsoTimestampSchema,
    }),
  ),
  geolocations: z.array(
    z.strictObject({
      countryCode: z.string(),
      countryName: z.string(),
      sessions: NonNegIntSchema,
      lastSeenAt: IsoTimestampSchema,
    }),
  ),
  clientBrands: z.array(
    z.strictObject({
      brand: z.string(),
      clientVersion: z.string(),
      platform: PlatformSchema,
      lastSeenAt: IsoTimestampSchema,
    }),
  ),
  bounces: z.array(
    z.strictObject({
      eventId: UuidSchema,
      occurredAt: IsoTimestampSchema,
      category: BounceCategorySchema,
      reason: z.string(),
      joinAddress: z.string().nullable(),
    }),
  ),
});
export type StaffPlayerOverlayResponse = z.infer<
  typeof StaffPlayerOverlayResponseSchema
>;
