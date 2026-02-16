import { z } from "zod";
import { PlayerSchema } from "./Player.js";

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export const LoginRequestSchema = z.strictObject({
  kind: z.literal("login"),
  value: z.object({
    token: z.string(),
  }),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export const LoginResponseSchema = z.strictObject({
  kind: z.literal("login"),
  value: PlayerSchema,
});
