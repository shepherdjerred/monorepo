import { z } from "zod";
import type { Pipeline } from "#src/schemas.ts";
import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { ciImageSteps } from "#src/pipeline/lanes/ci-images.ts";
import { scoutSteps, githubReleaseStep } from "#src/pipeline/lanes/scout.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL } from "#src/pipeline/cache.ts";
import { noWorkStep } from "#src/pipeline/completion.ts";

export const MaintenanceKindSchema = z.enum(["release-notes", "ci-images"]);
export type MaintenanceKind = z.infer<typeof MaintenanceKindSchema>;

/** Only a signed default-branch manual request can request these credentials. */
export function maintenanceRequest(pipeline: Pipeline, defaultBranch: string) {
  const kind = pipeline.variables["CI_MAINTENANCE_KIND"];
  if (kind === undefined) return;
  if (
    pipeline.event !== "manual" ||
    pipeline.branch !== defaultBranch ||
    pipeline.ref !== `refs/heads/${defaultBranch}` ||
    Object.keys(pipeline.variables).some((key) =>
      key.startsWith("TOFU_PLATFORM_"),
    )
  )
    throw new Error(
      "Maintenance requires an exclusive default-branch manual request",
    );
  return MaintenanceKindSchema.parse(kind);
}

export async function maintenanceMode(
  pipeline: Pipeline,
  defaultBranch: string,
  ownerControlled: boolean,
  enabled: (manual: boolean) => Promise<boolean>,
) {
  let kind: MaintenanceKind | undefined;
  try {
    kind = maintenanceRequest(pipeline, defaultBranch);
  } catch {
    return { error: "invalid maintenance request", status: 400 } as const;
  }
  const active = await enabled(kind !== undefined);
  return kind !== undefined && (!active || !ownerControlled)
    ? ({
        error: "maintenance lane is not enabled for this request",
        status: 403,
      } as const)
    : { kind, enabled: active };
}

export function requestedMaintenanceSteps(
  images: CiImages,
  kind: MaintenanceKind,
  pipeline: Pipeline,
) {
  const expectedSource = pipeline.variables["CI_MAINTENANCE_SOURCE"];
  return expectedSource !== undefined && expectedSource !== pipeline.commit
    ? [
        {
          ...noWorkStep(images.base),
          key: "maintenance-superseded",
          label: "maintenance source superseded",
        },
      ]
    : maintenanceSteps(images, kind);
}

export function maintenanceSteps(
  images: CiImages,
  kind: MaintenanceKind,
): CiStep[] {
  const release = scoutSteps(images).find(
    (step) => step.key === "release-please",
  );
  const refreshes = ciImageSteps(images).filter((step) =>
    step.key.endsWith("-refresh"),
  );
  if (release === undefined || refreshes.length !== 2)
    throw new Error("Maintenance lane contract changed");
  const template = kind === "release-notes" ? release : refreshes[0];
  if (template === undefined) throw new Error("Missing maintenance template");
  return [
    {
      ...template,
      key: `maintenance-${kind}`,
      label: `maintenance: ${kind}`,
      dependsOn: [],
      commands:
        kind === "release-notes"
          ? release.commands.map((command) =>
              command === "bun --no-install scripts/release/release.ts"
                ? `${command} --phase release-notes`
                : command,
            )
          : [
              "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
              "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
              "bun --no-install ci/scripts/images/refresh-ci-images.ts",
            ],
      timeoutMinutes: kind === "release-notes" ? 60 : 150,
      concurrency: { limit: 1, group: "ci-maintenance" },
      volumes: [BUN_CACHE, BUN_CACHE_CONTROL],
    },
  ];
}

/** Deployment still waits for GitHub releases and all application artifacts. */
export function separateMaintenance(steps: readonly CiStep[]): CiStep[] {
  return steps
    .filter(
      (step) =>
        !["ci-base-refresh", "ci-playwright-refresh"].includes(step.key),
    )
    .map((step) => {
      if (step.key === "helm-push")
        return {
          ...step,
          // Charts consume committed pins and this pipeline's image handoff.
          // Refresh workflows create separate PRs; their workspaces are isolated.
          dependsOn: ["homelab-release-admission", "images"],
        };
      return step.key === "release-please" ? githubReleaseStep(step) : step;
    });
}
