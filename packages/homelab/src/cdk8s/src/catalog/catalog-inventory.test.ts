import { beforeAll, describe, expect, test, vi } from "vitest";
import { App } from "cdk8s";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { z } from "zod";
import { PipelineDefinitionSchema } from "@shepherdjerred/delivery/contract";
import { CatalogDocumentSchema } from "@shepherdjerred/delivery/model-contract";
import {
  CATALOG_CORE,
  type CatalogCore,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import {
  CATALOG_REVISIONS_DIRECTORY,
  loadCatalogDocument,
} from "@shepherdjerred/ops-model/delivery-catalog/files.ts";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import type * as ReleaseConfiguration from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import {
  catalogApplications,
  recipeApplications,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-applications.ts";
import { catalogEnvironmentOf } from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";
import {
  ORDINARY_DELIVERY_ENVIRONMENTS,
  SPECIALIZED_DELIVERY_ENVIRONMENTS,
} from "homelab/src/delivery-target-policy.ts";
import {
  catalogRevisions,
  type CatalogRevisions,
  type V1Registration,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-revisions.ts";
import { derivedEdges } from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-edges.ts";

/**
 * Agreement test and generator for the catalog's recipe and configuration
 * revisions (`packages/delivery/registrations/v2/`). Each committed file must
 * equal what the Application constructors render with transition rendering
 * on, the state the window's final root release applies. Regenerate with
 * `bun run generate:catalog`, review the diff, and give every changed file a
 * new revision id in `packages/ops-model/catalog-document.json`: Delivery
 * refuses to change a registered revision (P1).
 */
vi.mock(
  "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts",
  async (importOriginal) => ({
    ...(await importOriginal<typeof ReleaseConfiguration>()),
    transitionRendering: () => true,
  }),
);

const REGISTRATIONS = new URL(
  "../../../../../delivery/registrations/",
  import.meta.url,
);
const CATALOG_DOCUMENT = new URL(
  "../../../../../ops-model/catalog-document.json",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const TOFU_STACKS = new URL("../../../tofu/", import.meta.url);
const RegistrationEnvironmentSchema = z.object({
  id: z.string(),
  configuration: z.record(z.string(), z.string()),
});

async function v1Registrations(): Promise<V1Registration[]> {
  const root = fileURLToPath(REGISTRATIONS);
  const files = await Array.fromAsync(
    new Bun.Glob("**/*pipeline.json").scan({ cwd: root }),
  );
  return Promise.all(
    files.toSorted().map(async (file) => ({
      environment: RegistrationEnvironmentSchema.parse(
        await Bun.file(
          `${root}/${file.replace(/pipeline\.json$/u, "environment.json")}`,
        ).json(),
      ),
      pipeline: PipelineDefinitionSchema.parse(
        await Bun.file(`${root}/${file}`).json(),
      ),
    })),
  );
}

/** Committed static-site recipes by environment; their v1 registrations are retired. */
async function siteRecipes(): Promise<Record<string, unknown>> {
  const root = fileURLToPath(new URL("v2/", REGISTRATIONS));
  const files = await Array.fromAsync(
    new Bun.Glob("*/*/recipe.json").scan({ cwd: root }),
  );
  const sites: Record<string, unknown> = {};
  for (const file of files.toSorted()) {
    const { definition } = z
      .object({ definition: z.looseObject({ kind: z.string() }) })
      .parse(await Bun.file(`${root}/${file}`).json());
    if (definition.kind === "static-site")
      sites[file.slice(0, file.lastIndexOf("/"))] = definition;
  }
  return sites;
}

async function runnerImage(): Promise<string> {
  const digest = await Bun.file(
    new URL("../../../../../../ci/ci-image/DIGEST", import.meta.url),
  ).text();
  return `docker.io/shepherdjerred/ci-base@${digest.trim()}`;
}

async function desiredStates(): Promise<Record<string, string>> {
  const root = fileURLToPath(TOFU_STACKS);
  const files = await Array.fromAsync(
    new Bun.Glob("*/desired-state.json").scan({ cwd: root }),
  );
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file.slice(0, file.indexOf("/")),
        await Bun.file(`${root}/${file}`).text(),
      ]),
    ),
  );
}

const RenderedApplicationSchema = z.looseObject({
  kind: z.literal("Application"),
  metadata: z.looseObject({ name: z.string() }),
});

/**
 * Rendered Applications no environment owns: the root, which the window
 * orphans, and postal-mariadb, which rides inside chart:postal.
 */
const UNOWNED_APPLICATIONS: ReadonlySet<string> = new Set([
  "apps",
  "postal-mariadb",
]);

function applicationOwners(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [environmentId, revision] of revisions)
    for (const name of recipeApplications(revision.recipe.definition))
      owners.set(name, [...(owners.get(name) ?? []), environmentId]);
  return owners;
}

async function formatted(value: unknown, file: string): Promise<string> {
  return prettier.format(JSON.stringify(value), {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });
}

const RevisionRecordSchema = z.record(z.string(), z.unknown());
const SnapshotStateSchema = z.looseObject({
  snapshotState: z
    .looseObject({ _updateSnapshot: z.string().optional() })
    .optional(),
});

function isSnapshotUpdateMode(): boolean {
  const parsed = SnapshotStateSchema.safeParse(expect.getState());
  return parsed.success && parsed.data.snapshotState?._updateSnapshot === "all";
}

export function nextCatalogRevisionId(revisionId: string): string {
  const match = /^(.+)\/(\d+)$/u.exec(revisionId);
  return match?.[1] === undefined || match[2] === undefined
    ? `${revisionId}/2`
    : `${match[1]}/${String(Number(match[2]) + 1)}`;
}

function canonicalPayloadValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => canonicalPayloadValue(item));
  if (typeof value === "object" && value !== null) {
    const record = RevisionRecordSchema.parse(value);
    return Object.fromEntries(
      Object.keys(record)
        .toSorted()
        .map((key) => [key, canonicalPayloadValue(record[key])]),
    );
  }
  return value;
}

function bumpedIdIfChanged(
  baseRaw: unknown,
  currentRaw: unknown,
): string | undefined {
  if (baseRaw === undefined) return;
  const { id: baseId, ...baseRest } = RevisionRecordSchema.parse(baseRaw);
  const { id: currId, ...currRest } = RevisionRecordSchema.parse(currentRaw);
  if (typeof baseId !== "string" || currId !== baseId) return;
  if (
    JSON.stringify(canonicalPayloadValue(currRest)) ===
    JSON.stringify(canonicalPayloadValue(baseRest))
  ) {
    return;
  }
  return nextCatalogRevisionId(baseId);
}

export type ReconciledCatalogRevisions = {
  core: CatalogCore;
  revisions: Map<string, CatalogRevisions>;
  bumped: Map<
    string,
    { recipeRevisionId?: string; configurationRevisionId?: string }
  >;
};

export async function reconcileUpdatedCatalogRevisions(
  core: CatalogCore,
  rendered: ReadonlyMap<string, CatalogRevisions>,
  readBaseRevision: (
    environmentId: string,
    kind: "recipe" | "configuration",
  ) => Promise<unknown>,
): Promise<ReconciledCatalogRevisions> {
  const nextRevisions = new Map<string, CatalogRevisions>();
  const bumped = new Map<
    string,
    { recipeRevisionId?: string; configurationRevisionId?: string }
  >();
  for (const [environmentId, current] of rendered) {
    const [baseRecipe, baseConfig] = await Promise.all([
      readBaseRevision(environmentId, "recipe"),
      readBaseRevision(environmentId, "configuration"),
    ]);
    const recipeId = bumpedIdIfChanged(baseRecipe, current.recipe);
    const configId = bumpedIdIfChanged(baseConfig, current.configuration);
    if (recipeId !== undefined || configId !== undefined) {
      bumped.set(environmentId, {
        ...(recipeId === undefined ? {} : { recipeRevisionId: recipeId }),
        ...(configId === undefined
          ? {}
          : { configurationRevisionId: configId }),
      });
    }
    nextRevisions.set(environmentId, {
      recipe:
        recipeId === undefined
          ? current.recipe
          : { ...current.recipe, id: recipeId },
      configuration:
        configId === undefined
          ? current.configuration
          : { ...current.configuration, id: configId },
    });
  }
  if (bumped.size === 0) return { core, revisions: new Map(rendered), bumped };
  return {
    revisions: nextRevisions,
    bumped,
    core: {
      ...core,
      environments: core.environments.map((env) => ({
        ...env,
        ...bumped.get(env.id),
      })),
    },
  };
}

async function runGit(
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn(["git", ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout };
}

async function resolveMergeBase(): Promise<string | undefined> {
  const requested = Bun.env["CI_CHANGED_BASE"]?.trim();
  const baseRef =
    requested !== undefined && requested.length > 0 ? requested : "origin/main";
  for (const args of [
    ["merge-base", baseRef, "HEAD"],
    ["rev-parse", "--verify", "HEAD"],
  ] as const) {
    const res = await runGit(args);
    if (res.exitCode === 0 && res.stdout.trim().length > 0)
      return res.stdout.trim();
  }
  return;
}

const RawCatalogDocumentSchema = z.looseObject({
  environments: z.array(z.looseObject({ id: z.string() })),
});

async function writeBumpedCatalogDocument(
  bumped: ReadonlyMap<
    string,
    { recipeRevisionId?: string; configurationRevisionId?: string }
  >,
): Promise<void> {
  const catalogFile = fileURLToPath(CATALOG_DOCUMENT);
  const raw = RawCatalogDocumentSchema.parse(
    await Bun.file(catalogFile).json(),
  );
  const updated = {
    ...raw,
    environments: raw.environments.map((env) => ({
      ...env,
      ...bumped.get(env.id),
    })),
  };
  await Bun.write(catalogFile, await formatted(updated, catalogFile));
}

let activeCore: CatalogCore = CATALOG_CORE;
let revisions: Map<string, CatalogRevisions>;
let edges: ReturnType<typeof derivedEdges>;
let renderedApplications: string[];
beforeAll(async () => {
  const app = new App({ outdir: ".test-synth-catalog" });
  await setupCharts(app);
  // Synthesis completes lazily built specs (cdk8s-plus workloads, patched
  // limits); read the charts as `dist` publishes them.
  app.synthYaml();
  const applications = catalogApplications(app);
  renderedApplications = app.charts
    .flatMap((chart) => z.array(z.unknown()).parse(chart.toJson()))
    .map((manifest) => RenderedApplicationSchema.safeParse(manifest))
    .filter((result) => result.success)
    .map((result) => result.data.metadata.name);
  revisions = catalogRevisions({
    core: CATALOG_CORE,
    app,
    applications,
    registrations: await v1Registrations(),
    desiredStates: await desiredStates(),
    siteRecipes: await siteRecipes(),
    runnerImage: await runnerImage(),
  });
  edges = derivedEdges({ core: CATALOG_CORE, app, applications, revisions });
});

describe("catalog revisions", () => {
  test("every committed recipe and configuration matches its constructor", async () => {
    if (isSnapshotUpdateMode()) {
      const baseCommit = await resolveMergeBase();
      if (baseCommit !== undefined) {
        const reconciled = await reconcileUpdatedCatalogRevisions(
          activeCore,
          revisions,
          async (environmentId, kind) => {
            const relPath = `packages/delivery/registrations/v2/${environmentId}/${kind}.json`;
            const shown = await runGit(["show", `${baseCommit}:${relPath}`]);
            if (shown.exitCode !== 0) return;
            const parsed: unknown = JSON.parse(shown.stdout);
            return parsed;
          },
        );
        if (reconciled.bumped.size > 0) {
          activeCore = reconciled.core;
          revisions = reconciled.revisions;
          await writeBumpedCatalogDocument(reconciled.bumped);
        }
      }
    }
    expect([...revisions.keys()].toSorted()).toEqual(
      activeCore.environments.map((environment) => environment.id).toSorted(),
    );
    for (const [environmentId, revision] of revisions)
      for (const [name, value] of [
        ["recipe.json", revision.recipe],
        ["configuration.json", revision.configuration],
      ] as const) {
        const file = fileURLToPath(
          new URL(`v2/${environmentId}/${name}`, REGISTRATIONS),
        );
        await expect(await formatted(value, file)).toMatchFileSnapshot(file);
      }
  });

  test("every rendered Application belongs to exactly one environment's recipe", () => {
    const owners = applicationOwners();
    expect(
      renderedApplications
        .filter((name) => !UNOWNED_APPLICATIONS.has(name))
        .filter((name) => owners.get(name)?.length !== 1),
    ).toEqual([]);
    for (const name of UNOWNED_APPLICATIONS)
      expect(owners.has(name), name).toBe(false);
  });

  test("the homelab target policy's Applications are their environments' recipes", () => {
    const owners = applicationOwners();
    for (const [application, v1] of Object.entries({
      ...ORDINARY_DELIVERY_ENVIRONMENTS,
      ...SPECIALIZED_DELIVERY_ENVIRONMENTS,
    })) {
      // The forum's beta chart is inactive and renders no Application.
      if (application === "storm-forum-beta") {
        expect(owners.has(application), application).toBe(false);
        continue;
      }
      expect(owners.get(application), application).toEqual([
        catalogEnvironmentOf(v1),
      ]);
    }
  });

  test("the catalog declares exactly the edges today's ordering contracts imply", () => {
    expect(CATALOG_CORE.edges).toEqual(edges);
  });

  test("the assembled catalog satisfies the language-neutral and Delivery contracts", async () => {
    const document = await loadCatalogDocument(
      CATALOG_REVISIONS_DIRECTORY,
      activeCore,
    );
    expect(() => CatalogDocumentSchema.parse(document)).not.toThrow();
  });

  test("auto-bumps immutable revision ids only when payload differs under the base id", async () => {
    const sampleEnv = CATALOG_CORE.environments[0];
    if (sampleEnv === undefined) throw new Error("Catalog has no environments");
    const sampleRevision = revisions.get(sampleEnv.id);
    if (sampleRevision === undefined) {
      throw new Error(`Missing rendered revision for ${sampleEnv.id}`);
    }
    const coreSlice: CatalogCore = {
      ...CATALOG_CORE,
      environments: [
        {
          ...sampleEnv,
          recipeRevisionId: "sample/prod/4",
          configurationRevisionId: "sample/prod/7",
        },
      ],
    };
    const renderedSlice = new Map<string, CatalogRevisions>([
      [
        sampleEnv.id,
        {
          recipe: { ...sampleRevision.recipe, id: "sample/prod/4" },
          configuration: {
            id: "sample/prod/7",
            content: { retention: "14d" },
            forwardOnly: [],
          },
        },
      ],
    ]);

    const bumpedResult = await reconcileUpdatedCatalogRevisions(
      coreSlice,
      renderedSlice,
      async (_envId, kind) =>
        kind === "recipe"
          ? { ...sampleRevision.recipe, id: "sample/prod/4" }
          : {
              id: "sample/prod/7",
              content: { retention: "7d" },
              forwardOnly: [],
            },
    );
    expect(bumpedResult.bumped.get(sampleEnv.id)).toEqual({
      configurationRevisionId: "sample/prod/8",
    });
    expect(bumpedResult.revisions.get(sampleEnv.id)?.configuration.id).toBe(
      "sample/prod/8",
    );
    expect(bumpedResult.revisions.get(sampleEnv.id)?.recipe.id).toBe(
      "sample/prod/4",
    );
    expect(bumpedResult.core.environments[0]?.configurationRevisionId).toBe(
      "sample/prod/8",
    );

    const alreadyBumped = await reconcileUpdatedCatalogRevisions(
      bumpedResult.core,
      bumpedResult.revisions,
      async (_envId, kind) =>
        kind === "recipe"
          ? { ...sampleRevision.recipe, id: "sample/prod/4" }
          : {
              id: "sample/prod/7",
              content: { retention: "7d" },
              forwardOnly: [],
            },
    );
    expect(alreadyBumped.bumped.size).toBe(0);
    expect(alreadyBumped.revisions.get(sampleEnv.id)?.configuration.id).toBe(
      "sample/prod/8",
    );
  });
});
