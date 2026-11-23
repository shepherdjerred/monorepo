import { z } from "zod";

export const ScoutReplayStageSchema = z.enum(["beta", "prod"]);
export type ScoutReplayStage = z.infer<typeof ScoutReplayStageSchema>;

const siteInventory = z.object({
  staticSites: z.array(
    z.object({
      hostname: z.string(),
      bucket: z.string().regex(/^[a-z\d][a-z\d.-]{1,61}[a-z\d]$/u),
    }),
  ),
});

export async function scoutTarget(stage: ScoutReplayStage) {
  const hostname =
    stage === "beta" ? "beta.scout-for-lol.com" : "scout-for-lol.com";
  const model = new URL(
    "../../../../../homelab/src/platform-model.json",
    import.meta.url,
  );
  const inventory = siteInventory.parse(await Bun.file(model).json());
  const matches = inventory.staticSites.filter(
    (site) => site.hostname === hostname,
  );
  const site = matches[0];
  if (site === undefined || matches.length !== 1)
    throw new Error(
      `Expected exactly one static site declaration for ${hostname}`,
    );
  return { bucket: site.bucket, origin: new URL(`https://${site.hostname}`) };
}
