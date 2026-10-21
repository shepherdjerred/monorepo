import { beforeAll, describe, expect, test, vi } from "vitest";
import { App } from "cdk8s";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { z } from "zod";
import { PipelineDefinitionSchema } from "@shepherdjerred/delivery/contract";
import { CatalogDocumentSchema } from "@shepherdjerred/delivery/model-contract";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { loadCatalogDocument } from "@shepherdjerred/ops-model/delivery-catalog/files.ts";
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
  applicationReleasePolicy,
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
 * orphans; postal-mariadb, which rides inside chart:postal; and the two
 * operators the recipe contract cannot express yet (a Kustomize path and a
 * scheme-less OCI repository).
 */
const UNOWNED_APPLICATIONS: ReadonlySet<string> = new Set([
  "apps",
  "cloudflare-operator",
  "kueue",
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
  });
  edges = derivedEdges({ core: CATALOG_CORE, app, applications, revisions });
});

describe("catalog revisions", () => {
  test("every committed recipe and configuration matches its constructor", async () => {
    expect([...revisions.keys()].toSorted()).toEqual(
      CATALOG_CORE.environments.map((environment) => environment.id).toSorted(),
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
      // Neither renders an Application today: the launcher's chart is
      // prepared and the forum's beta chart is inactive.
      if (
        application === "glitter-boys-launcher" ||
        application === "storm-forum-beta"
      ) {
        expect(owners.has(application), application).toBe(false);
        continue;
      }
      expect(owners.get(application), application).toEqual([
        catalogEnvironmentOf(v1),
      ]);
    }
    for (const name of ["pokemon", "mario-kart"]) {
      expect(applicationReleasePolicy(name).owner).toBe("release-root");
      const environmentId = owners.get(name)?.[0];
      expect(
        CATALOG_CORE.environments.find(
          (environment) => environment.id === environmentId,
        )?.lifecycle,
        name,
      ).toBe("retired");
    }
  });

  test("the catalog declares exactly the edges today's ordering contracts imply", () => {
    expect(CATALOG_CORE.edges).toEqual(edges);
  });

  test("the assembled catalog satisfies the language-neutral and Delivery contracts", async () => {
    const document = await loadCatalogDocument();
    expect(() => CatalogDocumentSchema.parse(document)).not.toThrow();
  });
});
