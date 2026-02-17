import { z } from "zod";
import { LoginRequestSchema, LoginResponseSchema } from "./Login.js";
import { StatusRequestSchema, StatusResponseSchema } from "./Status.js";
import { CommandRequestSchema } from "./Command.js";
import {
  ScreenshotRequestSchema,
  ScreenshotResponseSchema,
} from "./Screenshot.js";

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
