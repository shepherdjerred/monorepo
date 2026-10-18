import { z } from "zod";
import recipe from "./native-observation.json" with { type: "json" };

/** One reviewed recipe shared by the native reader and its CONNECT admission boundary. */
export const forumNativeObservation = z
  .object({
    schemaVersion: z.literal(1),
    namespaces: z.tuple([
      z.literal("storm-forum"),
      z.literal("storm-forum-beta"),
    ]),
    podPrefix: z.literal("storm-forum-web-"),
    container: z.literal("php"),
    claims: z.tuple([
      z.literal("storm-forum-files"),
      z.literal("storm-forum-database"),
    ]),
    command: z.tuple([z.literal("php"), z.literal("-r"), z.string().min(1)]),
  })
  .strict()
  .parse(recipe);
