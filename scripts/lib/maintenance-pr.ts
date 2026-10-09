import { z } from "zod";
import { run } from "./run.ts";

export const MaintenancePrSchema = z.object({
  number: z.number().int().positive(),
  isDraft: z.boolean(),
  headRefOid: z.string().regex(/^[a-f0-9]{40}$/u),
});
export type MaintenancePr = z.infer<typeof MaintenancePrSchema>;

export function deferReadyMaintenancePr(
  pr: MaintenancePr | undefined,
): boolean {
  if (pr?.isDraft !== false) return false;
  console.log("CI_IMAGE_PROMOTION_DEFERRED");
  return true;
}

export async function readMaintenancePr(
  branch: string,
  env: Record<string, string>,
  execute: typeof run = run,
): Promise<MaintenancePr | undefined> {
  const result = await execute(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      "shepherdjerred/monorepo",
      "--head",
      branch,
      "--base",
      "main",
      "--state",
      "open",
      "--json",
      "number,isDraft,headRefOid",
    ],
    { env, capture: true },
  );
  const matches = z.array(MaintenancePrSchema).parse(JSON.parse(result.stdout));
  if (matches.length > 1)
    throw new Error(`Multiple maintenance PRs for ${branch}`);
  return matches[0];
}

export function assertDraftUnchanged(
  pr: MaintenancePr | undefined,
  expectedSha?: string,
): void {
  if (
    pr !== undefined &&
    (!pr.isDraft ||
      (expectedSha !== undefined && pr.headRefOid !== expectedSha))
  ) {
    throw new Error(
      "Maintenance PR is ready or changed; preserve its head and defer the candidate",
    );
  }
}
