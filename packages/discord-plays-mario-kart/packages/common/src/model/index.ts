import { z } from "zod";
import { LoginRequestSchema, LoginResponseSchema } from "./login.ts";
import { StatusRequestSchema, StatusResponseSchema } from "./status.ts";
import {
  ScreenshotRequestSchema,
  ScreenshotResponseSchema,
} from "./screenshot.ts";
import {
  InputRequestSchema,
  LatencyReportRequestSchema,
  SeatClaimRequestSchema,
  SeatReleaseRequestSchema,
  SeatResponseSchema,
  SeatsResponseSchema,
} from "./input.ts";

export type Request = z.infer<typeof RequestSchema>;
export const RequestSchema = z.discriminatedUnion("kind", [
  LoginRequestSchema,
  InputRequestSchema,
  LatencyReportRequestSchema,
  SeatClaimRequestSchema,
  SeatReleaseRequestSchema,
  ScreenshotRequestSchema,
  StatusRequestSchema,
]);

export type Response = z.infer<typeof ResponseSchema>;
export const ResponseSchema = z.discriminatedUnion("kind", [
  LoginResponseSchema,
  StatusResponseSchema,
  ScreenshotResponseSchema,
  SeatResponseSchema,
  SeatsResponseSchema,
]);
