import { z } from "zod";
import { CutKindSchema } from "#shared/editions/evidence.ts";

export const MovieEditionKeySchema = z.enum([
  "default",
  ...CutKindSchema.options,
]);
export const MovieEditionPolicySchema = z.enum([
  "standard_unmarked",
  ...CutKindSchema.options,
]);
export type MovieEditionKey = z.infer<typeof MovieEditionKeySchema>;
export const MOVIE_EDITION_REGISTRY_VERSION = 1;
export const MOVIE_EDITION_REGISTRY = {
  default: {
    policy: "standard_unmarked",
    pathLabel: "",
    plexLabel: "",
    displayLabel: "Unmarked release — no named cut asserted",
  },
  theatrical_cut: {
    policy: "theatrical_cut",
    pathLabel: "theatrical-cut",
    plexLabel: "Theatrical Cut",
    displayLabel: "Theatrical cut",
  },
  directors_cut: {
    policy: "directors_cut",
    pathLabel: "directors-cut",
    plexLabel: "Director's Cut",
    displayLabel: "Director's cut",
  },
  extended_cut: {
    policy: "extended_cut",
    pathLabel: "extended-cut",
    plexLabel: "Extended Cut",
    displayLabel: "Extended cut",
  },
  final_cut: {
    policy: "final_cut",
    pathLabel: "final-cut",
    plexLabel: "Final Cut",
    displayLabel: "Final cut",
  },
  unrated_cut: {
    policy: "unrated_cut",
    pathLabel: "unrated-cut",
    plexLabel: "Unrated Cut",
    displayLabel: "Unrated cut",
  },
  uncut_version: {
    policy: "uncut_version",
    pathLabel: "uncut-version",
    plexLabel: "Uncut Version",
    displayLabel: "Uncut version",
  },
} as const;

export const MovieEditionHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const MovieEditionScopeSchema = z
  .strictObject({
    rootMediaId: z.uuid(),
    mediaId: z.uuid(),
    edition: MovieEditionKeySchema,
  })
  .refine(
    (value) => value.rootMediaId === value.mediaId,
    "A movie edition must belong to its canonical movie",
  );

export const MovieEditionDefinitionSchema = z
  .strictObject({
    rootMediaId: z.uuid(),
    key: MovieEditionKeySchema,
    policy: MovieEditionPolicySchema,
    pathLabel: z.string().max(80),
    plexLabel: z.string().max(80),
    definitionVersion: z.literal(0),
  })
  .refine((value) => {
    const registered = MOVIE_EDITION_REGISTRY[value.key];
    return (
      value.policy === registered.policy &&
      value.pathLabel === registered.pathLabel &&
      value.plexLabel === registered.plexLabel
    );
  }, "Movie edition definition differs from registry authority");

export const MovieEditionDefinitionRefSchema = z.strictObject({
  definitionVersion: z.literal(0),
  definitionDigest: MovieEditionHashSchema,
});
export type MovieEditionScope = z.infer<typeof MovieEditionScopeSchema>;
export type MovieEditionDefinition = z.infer<
  typeof MovieEditionDefinitionSchema
>;
export type MovieEditionDefinitionRef = z.infer<
  typeof MovieEditionDefinitionRefSchema
>;

export function movieEditionDefinition(
  rootMediaId: string,
  edition: MovieEditionKey,
): MovieEditionDefinition {
  const { policy, pathLabel, plexLabel } = MOVIE_EDITION_REGISTRY[edition];
  return MovieEditionDefinitionSchema.parse({
    rootMediaId,
    key: edition,
    policy,
    pathLabel,
    plexLabel,
    definitionVersion: 0,
  });
}
export function movieEditionDisplayLabel(edition: MovieEditionKey): string {
  return MOVIE_EDITION_REGISTRY[edition].displayLabel;
}
