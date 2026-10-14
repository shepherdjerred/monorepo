import { z } from "zod";
import type { RconClient } from "./rcon.ts";
import { plain } from "./rwfbots.ts";

const ChatStateSchema = z.object({
  gate: z.object({
    enabled: z.boolean(),
    closed: z.boolean(),
    checking: z.boolean(),
    directorPresent: z.boolean(),
  }),
  clocks: z.object({
    now: z.string().min(1),
    refreshDue: z.string().min(1),
    idleDue: z.string().min(1).optional(),
  }),
  lifecycle: z.object({
    observedMatch: z.uuid().optional(),
    observedPhase: z
      .enum([
        "LOBBY",
        "COUNTDOWN",
        "PREPARING",
        "PREVIEW",
        "FREEZE",
        "LIVE",
        "ENDED",
        "RESETTING",
      ])
      .optional(),
    sessionMatch: z.uuid().optional(),
    directorMatch: z.uuid().optional(),
  }),
  speakers: z.array(
    z.object({
      identity: z.object({
        uuid: z.uuid(),
        name: z.string().min(1),
        alive: z.boolean(),
        presence: z.object({ rostered: z.boolean(), nativeBody: z.boolean() }),
      }),
      lookup: z.object({
        id: z.number().int().nonnegative().optional(),
        thought: z
          .object({
            tick: z.number().int().nonnegative(),
            lifeEpoch: z.number().int().nonnegative(),
            option: z.string().min(1),
            goal: z.object({
              waypoints: z.number().int().nonnegative(),
              target: z.number().int().nonnegative().optional(),
              ability: z.string().optional(),
              failed: z.boolean(),
            }),
          })
          .optional(),
      }),
      queued: z
        .object({
          line: z.object({
            moment: z.string().min(1),
            teamOnly: z.boolean(),
            text: z.string(),
          }),
          timing: z.object({
            starts: z.string().min(1),
            ends: z.string().min(1),
            lifeEpoch: z.number().int().min(-1),
          }),
        })
        .optional(),
    }),
  ),
});
export type ChatState = z.infer<typeof ChatStateSchema>;

/** Samples the actual service during the existing completion wait, without advancing speech. */
export function watcherChatProbe(rcon: RconClient) {
  const snapshots: ChatState[] = [];
  let nextSample = 0;
  return {
    snapshots,
    async sample(): Promise<void> {
      const now = Date.now();
      if (now < nextSample) return;
      if (snapshots.length >= 900) {
        throw new Error("Watcher chat probe exceeded its 900-snapshot bound");
      }
      nextSample = now + 1000;
      const text = plain(
        await rcon.command("storm-fixture-map-lifecycle chat-status"),
      );
      snapshots.push(ChatStateSchema.parse(JSON.parse(text)));
    },
  };
}
