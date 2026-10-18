import { z } from "zod";

export const SavePlexProfileSchema = z
  .object({
    homeUserId: z.string().regex(/^[1-9]\d*$/u),
    serverAccountId: z.string().regex(/^[1-9]\d*$/u),
    expectedVersion: z.number().int().nonnegative().nullable(),
    confirmedIdentity: z.literal(true),
    pin: z
      .string()
      .regex(/^\d{4}$/u)
      .optional(),
  })
  .strict();
export type SavePlexProfile = z.infer<typeof SavePlexProfileSchema>;
export const PlexProfilesSchema = z.object({
  homeUsers: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      restricted: z.boolean(),
      protected: z.boolean(),
    }),
  ),
  serverAccounts: z.array(z.object({ id: z.string(), name: z.string() })),
  mappings: z.array(
    z.object({
      userId: z.string(),
      globalAccountId: z.string(),
      displayName: z.string(),
      serverAccountId: z.string().nullable(),
      homeUserId: z.string().nullable(),
      kind: z.enum(["account", "managed"]),
      version: z.number().int(),
      permittedSectionIds: z.array(z.string()),
      verifiedAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type PlexProfiles = z.infer<typeof PlexProfilesSchema>;
