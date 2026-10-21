import { z } from "zod";
import {
  PublishBuildSchema,
  PlatformChangesSchema,
} from "@shepherdjerred/delivery/contract";
import type { PublishBuild } from "@shepherdjerred/delivery/contract";
import type { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Catalog } from "@shepherdjerred/ops-model/catalog.ts";
import {
  PLATFORM_POLICY,
  TOFU_STACK_POLICIES,
  TofuStackSchema,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import type {
  TofuStack,
  PlatformPrerequisiteSchema,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import { globalPaths } from "../../../ci/scripts/migration-core.ts";
import { workspacePaths } from "../../../ci/scripts/selectors/site-lane-paths.ts";
import { ensureAncestor } from "../../../ci/scripts/selectors/ensure-ancestor.ts";
import { STACK_MANIFEST } from "../../../packages/homelab/scripts/tofu/tofu-stack-manifest.ts";
import {
  independentStaticSites,
  isStaticSiteArtifact,
  staticSiteBucket,
  staticSiteEnvironment,
  staticSiteServiceId,
} from "./static-site-publications.ts";

const managedStacks = TofuStackSchema.options.filter((stack) =>
  ["automatic", "reviewed-plan"].includes(TOFU_STACK_POLICIES[stack].mode),
);
const within = (file: string, directory: string) =>
  file === directory || file.startsWith(`${directory}/`);

/** Unknown history repeats the existing bounded CI policy: qualify every managed stack. */
export function changedPlatformStacks(
  files: readonly string[] | undefined,
): TofuStack[] {
  if (files === undefined) return [...managedStacks];
  const shared = [
    ...globalPaths,
    ...workspacePaths,
    "packages/homelab/scripts/tofu",
    "scripts/lib/ci/delivery-platform-publication.ts",
    "packages/ops-model/platform-policy.json",
    "packages/ops-model/src/platform-policy.ts",
  ];
  const sensitiveShared = [
    "packages/homelab/scripts/platform-desired-state.ts",
    "packages/homelab/src/tofu/platform-desired-state.schema.json",
  ];
  return managedStacks.filter((stack) =>
    files.some(
      (file) =>
        shared.some((path) => within(file, path)) ||
        within(file, `packages/homelab/src/tofu/${stack}`) ||
        STACK_MANIFEST[stack].externalFiles.some((input) =>
          within(file, input),
        ) ||
        (TOFU_STACK_POLICIES[stack].mode === "reviewed-plan" &&
          sensitiveShared.some((path) => within(file, path))),
    ),
  );
}

/** The immutable publication includes the full prerequisite closure, never just a leaf apply. */
export function platformDependencyClosure(
  root: boolean,
  selected: readonly TofuStack[],
) {
  const stacks = new Set(selected);
  let requireRoot = root;
  function include(prerequisite: z.infer<typeof PlatformPrerequisiteSchema>) {
    if (prerequisite === "static-sites") return;
    if (prerequisite === "root") {
      requireRoot = true;
      return;
    }
    stacks.add(TofuStackSchema.parse(prerequisite.slice("tofu:".length)));
  }
  for (;;) {
    const previous = `${String(requireRoot)}:${[...stacks].sort().join(",")}`;
    if (requireRoot)
      for (const prerequisite of PLATFORM_POLICY.rootPrerequisites)
        include(prerequisite);
    for (const stack of stacks)
      for (const prerequisite of TOFU_STACK_POLICIES[stack].prerequisites)
        include(prerequisite);
    if (previous === `${String(requireRoot)}:${[...stacks].sort().join(",")}`)
      break;
  }
  return { root: requireRoot, tofuStacks: [...stacks].sort() };
}

async function execute(command: readonly string[]) {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "inherit" });
  const stdout = await new Response(child.stdout).text();
  return { exitCode: await child.exited, stdout };
}

export async function platformSourceFiles(
  source: string,
  base: string | undefined,
): Promise<readonly string[] | undefined> {
  z.string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(source);
  if (base === undefined || !/^[a-f0-9]{40}$/u.test(base)) return undefined;
  if (!(await ensureAncestor(base, source, execute, true))) return undefined;
  const changes = await execute([
    "git",
    "diff",
    "--name-only",
    "-z",
    base,
    source,
    "--",
  ]);
  if (changes.exitCode !== 0)
    throw new Error("Platform source comparison failed");
  return changes.stdout.split("\0").filter(Boolean);
}

export async function attachPlatformPublication(
  publications: readonly PublishBuild[],
  input: {
    files: readonly string[] | undefined;
    rootInventory: readonly { name: string; revision: string }[] | undefined;
    /** Unchanged charts this producer retained by qualified Delivery artifact. */
    retainedCharts?:
      | readonly { name: string; revision: string; artifactId: string }[]
      | undefined;
    sourceRevision: string;
    ciUrl: string;
    pipelineNumber: number;
    repositoryId: number;
    capturedAt: string;
    catalog?: Catalog;
  },
  retainedAnchor: () => Promise<string>,
  retainedSite?: (
    bucket: string,
  ) => Promise<z.infer<typeof ArtifactVersionSchema>>,
): Promise<PublishBuild[]> {
  const catalog = new ServiceIndex(input.catalog ?? SERVICE_CATALOG);
  const charts = publications.flatMap((build) =>
    build.artifacts.filter((artifact) => artifact.kind === "chart"),
  );
  const closure = platformDependencyClosure(
    charts.length > 0,
    changedPlatformStacks(input.files),
  );
  const rootArtifacts: Record<string, string> = {};
  if (closure.root) {
    for (const expected of catalog.rootReleaseCharts()) {
      const revision = input.rootInventory?.find(
        (chart) => chart.name === expected.name,
      )?.revision;
      const fresh = publications
        .find((build) => build.serviceId === expected.serviceId)
        ?.artifacts.find(
          (entry) =>
            entry.component === `chart:${expected.name}` &&
            entry.kind === "chart" &&
            entry.version === revision,
        );
      const retained = input.retainedCharts?.find(
        (chart) => chart.name === expected.name && chart.revision === revision,
      );
      const artifactId = fresh?.id ?? retained?.artifactId;
      if (artifactId === undefined)
        throw new Error(
          `Platform release requires this CI's chart receipt or its retained qualified chart at the inventory revision for ${expected.name}`,
        );
      rootArtifacts[expected.name] = artifactId;
    }
  }
  // A site archive published under its own service releases independently;
  // one published under another owner (Scout's frontends) rides that
  // service's combined deployment and is no root prerequisite.
  const freshSites = publications.flatMap((build) =>
    build.artifacts.filter(isStaticSiteArtifact).flatMap((artifact) => {
      const bucket = staticSiteBucket(artifact.component);
      if (build.serviceId !== staticSiteServiceId(bucket)) return [];
      return [
        {
          environmentId: staticSiteEnvironment(bucket),
          artifactId: artifact.id,
        },
      ];
    }),
  );
  const selectedSites = new Map(
    freshSites.map((site) => [site.environmentId, site.artifactId]),
  );
  if (retainedSite !== undefined && closure.root) {
    const originals = await Promise.all(
      independentStaticSites()
        .filter((site) => !selectedSites.has(site.environmentId))
        .map(async ({ bucket, serviceId, environmentId }) => {
          const artifact = await retainedSite(bucket);
          if (
            artifact.serviceId !== serviceId ||
            artifact.component !== `site:${bucket}` ||
            artifact.kind !== "archive" ||
            artifact.origin.kind !== "first-party"
          )
            throw new Error(
              "Root site prerequisite must retain its original qualified bucket archive",
            );
          return { environmentId, artifactId: artifact.id };
        }),
    );
    for (const site of originals)
      selectedSites.set(site.environmentId, site.artifactId);
  }
  const sites = [...selectedSites]
    .map(([environmentId, artifactId]) => ({ environmentId, artifactId }))
    .sort((a, b) => a.environmentId.localeCompare(b.environmentId));
  if (!closure.root && closure.tofuStacks.length === 0 && sites.length === 0)
    return [...publications];
  const platformChanges = PlatformChangesSchema.parse({
    ...closure,
    rootArtifacts,
    sites,
  });
  const existing = publications.find((build) => build.serviceId === "gitops");
  const source =
    existing ??
    PublishBuildSchema.parse({
      requestId: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/gitops`,
      serviceId: "gitops",
      sourceRevision: input.sourceRevision,
      ciUrl: input.ciUrl,
      verifiedAt: input.capturedAt,
      artifacts: [],
      retainedArtifactIds: [await retainedAnchor()],
    });
  return [
    ...publications.filter((build) => build !== existing),
    PublishBuildSchema.parse({ ...source, platformChanges }),
  ];
}
