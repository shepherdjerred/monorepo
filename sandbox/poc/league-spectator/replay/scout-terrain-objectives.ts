import { z } from "zod";

const labels = {
  sru_baron: "Baron Nashor",
  sru_riftherald: "Rift Herald",
  sru_horde: "Void Grub",
  sru_dragon_air: "Cloud Drake",
  sru_dragon_earth: "Mountain Drake",
  sru_dragon_chemtech: "Chemtech Drake",
  sru_dragon_fire: "Infernal Drake",
  sru_dragon_water: "Ocean Drake",
  sru_dragon_hextech: "Hextech Drake",
} as const;

export const NeutralObjectiveModelIdSchema = z.enum(
  Object.keys(labels) as (keyof typeof labels)[],
);
type NeutralObjectiveModelId = z.infer<typeof NeutralObjectiveModelIdSchema>;

export const NeutralCampModelIdSchema = z.enum([
  "sru_blue",
  "sru_crab",
  "sru_gromp",
  "sru_krug",
  "sru_krugmini",
  "sru_murkwolf",
  "sru_murkwolfmini",
  "sru_razorbeak",
  "sru_razorbeakmini",
  "sru_red",
]);

const count = z.number().int().nonnegative();
export const NeutralCampCoverageSchema = z
  .strictObject({
    births: count,
    closed: count,
    open: count,
    omissions: z.strictObject({
      unsupportedCampNames: count,
      incompleteLifecycle: count,
      missingRecordedMotion: count,
    }),
  })
  .refine(
    ({ births, closed, open, omissions }) =>
      births ===
        closed +
          open +
          omissions.unsupportedCampNames +
          omissions.incompleteLifecycle &&
      omissions.missingRecordedMotion <= closed + open,
    "Neutral camp coverage must account for recorded births",
  );

export function neutralObjectiveLabel(id: NeutralObjectiveModelId): string {
  return labels[id];
}

const context = z.number().int().positive().max(0xffffffff);
const neutralKill = z.object({
  actorContext: context,
  modelId: NeutralObjectiveModelIdSchema,
  timeSeconds: z.number().positive(),
});

export const NeutralObjectiveKillsSchema = z.array(
  neutralKill.extend({
    position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  }),
);

export const NeutralObjectiveWorkerKillsSchema = z.array(
  neutralKill.extend({
    subjectContext: context,
    position: z.tuple([z.number(), z.number()]).optional(),
  }),
);
