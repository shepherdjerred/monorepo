import { z } from "zod";

const Experience = z.strictObject({
  difficulty: z.literal("hard"),
  style: z.literal("varied"),
  variety: z.literal("high"),
  maps: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
  kits: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
});
const Configuration = z.looseObject({ experience: Experience });

/** Keeps the private camera in the arena through an ordinary early death and end screen. */
export const authoredCombatMatch = {
  countdown: "PT15S",
  targetCombatants: 2,
  maxCombatants: 2,
  automaticSizing: false,
  endLinger: "PT30S",
} as const;

/** The first startup ballot freezes settings; a next-draft command is already too late. */
export function trooperCombatProfile(raw: unknown) {
  const source = Configuration.parse(raw);
  const configuration = {
    ...source,
    experience: { ...source.experience, kits: ["trooper"] },
  };
  return {
    original: source.experience,
    configuration,
    text: Bun.YAML.stringify(configuration, null, 2),
  };
}
