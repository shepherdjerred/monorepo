import { z } from "zod";

/** qBittorrent 5.2.4 serializes MAX_RATIO as -1; never persist JS Infinity. */
export const TorrentRatioSchema = z
  .union([z.literal(-1), z.number().nonnegative()])
  .transform(
    (value): { kind: "finite"; value: number } | { kind: "infinite" } =>
      value === -1 ? { kind: "infinite" } : { kind: "finite", value },
  );

const ConfiguredLimit = z.union([
  z.literal(-2),
  z.literal(-1),
  z.number().nonnegative(),
]);
const EffectiveLimit = z.union([z.literal(-1), z.number().nonnegative()]);

/** Time limits are MINUTES, including max_*; seeding_time is elapsed seconds. */
export const TorrentPolicySchema = z.object({
  ratio_limit: ConfiguredLimit,
  seeding_time_limit: ConfiguredLimit.refine(Number.isInteger),
  inactive_seeding_time_limit: ConfiguredLimit.refine(Number.isInteger),
  max_ratio: EffectiveLimit,
  max_seeding_time: EffectiveLimit.refine(Number.isInteger),
  max_inactive_seeding_time: EffectiveLimit.refine(Number.isInteger),
  share_limit_action: z.enum([
    "Default",
    "Stop",
    "Remove",
    "RemoveWithContent",
    "EnableSuperSeeding",
  ]),
  auto_tmm: z.boolean(),
  force_start: z.boolean(),
});

/** Native limits must not race the application's minimum seeding obligations. */
export function hasApplicationSeedingPolicy(
  value: z.infer<typeof TorrentPolicySchema>,
): boolean {
  return (
    value.ratio_limit === -1 &&
    value.seeding_time_limit === -1 &&
    value.inactive_seeding_time_limit === -1 &&
    value.max_ratio === -1 &&
    value.max_seeding_time === -1 &&
    value.max_inactive_seeding_time === -1 &&
    value.share_limit_action === "Stop" &&
    !value.auto_tmm &&
    !value.force_start
  );
}
