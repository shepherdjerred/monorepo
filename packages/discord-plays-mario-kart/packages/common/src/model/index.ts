import { z } from "zod";
import { StatusRequestSchema, StatusResponseSchema } from "./status.ts";
import {
  ScreenshotRequestSchema,
  ScreenshotResponseSchema,
} from "./screenshot.ts";
import {
  InputRequestSchema,
  LatencyReportRequestSchema,
  SeatClaimRequestSchema,
  SeatDeniedResponseSchema,
  SeatReleaseRequestSchema,
  SeatResponseSchema,
  SeatsResponseSchema,
} from "./input.ts";
import {
  LeaderboardRequestSchema,
  LeaderboardResponseSchema,
  PlayerStatsRequestSchema,
  PlayerStatsResponseSchema,
  RecentRacesRequestSchema,
  RecentRacesResponseSchema,
} from "./leaderboard.ts";

export type Request = z.infer<typeof RequestSchema>;
export const RequestSchema = z.discriminatedUnion("kind", [
  InputRequestSchema,
  LatencyReportRequestSchema,
  SeatClaimRequestSchema,
  SeatReleaseRequestSchema,
  ScreenshotRequestSchema,
  StatusRequestSchema,
  LeaderboardRequestSchema,
  PlayerStatsRequestSchema,
  RecentRacesRequestSchema,
]);

export type Response = z.infer<typeof ResponseSchema>;
export const ResponseSchema = z.discriminatedUnion("kind", [
  StatusResponseSchema,
  ScreenshotResponseSchema,
  SeatResponseSchema,
  SeatsResponseSchema,
  SeatDeniedResponseSchema,
  LeaderboardResponseSchema,
  PlayerStatsResponseSchema,
  RecentRacesResponseSchema,
]);
