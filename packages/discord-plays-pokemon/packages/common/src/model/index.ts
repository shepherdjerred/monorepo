import { z } from "zod";
import { LoginRequestSchema, LoginResponseSchema } from "./login.js";
import { StatusRequestSchema, StatusResponseSchema } from "./status.js";
import { CommandRequestSchema } from "./command.js";
import {
  ScreenshotRequestSchema,
  ScreenshotResponseSchema,
} from "./screenshot.js";

export type Request = z.infer<typeof RequestSchema>;
export const RequestSchema = z.discriminatedUnion("kind", [
  LoginRequestSchema,
  CommandRequestSchema,
  ScreenshotRequestSchema,
  StatusRequestSchema,
]);

export type Response = z.infer<typeof ResponseSchema>;
export const ResponseSchema = z.discriminatedUnion("kind", [
  LoginResponseSchema,
  StatusResponseSchema,
  ScreenshotResponseSchema,
]);
