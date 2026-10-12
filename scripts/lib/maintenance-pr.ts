import { asRecord } from "./json.ts";
import { run } from "./run.ts";

export type MaintenancePr = {
  number: number;
  isDraft: boolean;
  headRefOid: string;
};

/** Image promotion runs before workspace dependencies are installed. */
export function parseMaintenancePr(value: unknown): MaintenancePr {
  const record = asRecord(value);
  if (record === null) throw new TypeError("Invalid maintenance PR object");
  const { number, isDraft, headRefOid } = record;
  if (
    typeof number !== "number" ||
    number <= 0 ||
    !Number.isSafeInteger(number)
  ) {
    throw new TypeError("Invalid maintenance PR number");
  }
  if (typeof isDraft !== "boolean") {
    throw new TypeError("Invalid maintenance PR draft status");
  }
  if (typeof headRefOid !== "string" || !/^[a-f0-9]{40}$/u.test(headRefOid)) {
    throw new TypeError("Invalid maintenance PR head SHA");
  }
  return { number, isDraft, headRefOid };
}

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
  const response: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(response))
    throw new TypeError("Maintenance PR response must be an array");
  const matches = response.map((value: unknown) => parseMaintenancePr(value));
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
