import { z } from "zod/v4";

export const DiscordIndexPermissionsSchema = z.object({
  user: z.boolean().optional(),
  roles: z.record(z.string(), z.boolean()).optional(),
  channels: z.record(z.string(), z.boolean()).optional(),
});
export const DiscordCommandPermissionFields = {
  default_member_permissions: z.string().regex(/^\d+$/).nullable().optional(),
  permissions: DiscordIndexPermissionsSchema.optional(),
};

/** Resolve native defaults; configured overrides must never silently become a pass. */
export function discordCommandPermission(input: {
  administrator: boolean;
  memberPermissions: string;
  required: string | null | undefined;
  application: z.infer<typeof DiscordIndexPermissionsSchema> | undefined;
  command: z.infer<typeof DiscordIndexPermissionsSchema> | undefined;
}) {
  if (input.administrator) return { allowed: true, reason: "Administrator" };
  if (
    [input.application, input.command].some(
      (p) =>
        p?.user !== undefined ||
        Object.keys(p?.roles ?? {}).length > 0 ||
        Object.keys(p?.channels ?? {}).length > 0,
    )
  )
    throw new Error(
      "Custom command permissions require explicit override resolution; execution permission is unverified",
    );
  if (input.required == null)
    return {
      allowed: true,
      reason: "No required permission bits or configured overrides",
    };
  const required = BigInt(input.required);
  const allowed =
    required !== 0n &&
    (BigInt(input.memberPermissions) & required) === required;
  return {
    allowed,
    reason: allowed
      ? "Required permission bits are present"
      : "Required command permission bits are missing or command is disabled",
  };
}
