import { z } from "zod";
import { StatusResponseSchema } from "./status.ts";
import { StatusRequestSchema } from "@shepherdjerred/discord-plays-core/webserver/protocol.ts";
import { CommandRequestSchema } from "./command.ts";
import { StateResponseSchema } from "./game-state.ts";
import {
  EventsResponseSchema,
  InputResultResponseSchema,
  InputsResponseSchema,
} from "./feed.ts";

export type Request = z.infer<typeof RequestSchema>;
export const RequestSchema = z.discriminatedUnion("kind", [
  CommandRequestSchema,
  StatusRequestSchema,
]);

export type Response = z.infer<typeof ResponseSchema>;
export const ResponseSchema = z.discriminatedUnion("kind", [
  StatusResponseSchema,
  StateResponseSchema,
  EventsResponseSchema,
  InputsResponseSchema,
  InputResultResponseSchema,
]);
