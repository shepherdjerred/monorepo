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
import { catalogApplications } from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-applications.ts";
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

async function formatted(value: unknown, file: string): Promise<string> {
  return prettier.format(JSON.stringify(value), {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });
}

let revisions: Map<string, CatalogRevisions>;
let edges: ReturnType<typeof derivedEdges>;
beforeAll(async () => {
  const app = new App({ outdir: ".test-synth-catalog" });
  await setupCharts(app);
  // Synthesis completes lazily built specs (cdk8s-plus workloads, patched
  // limits); read the charts as `dist` publishes them.
  app.synthYaml();
  const applications = catalogApplications(app);
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

  test("the catalog declares exactly the edges today's ordering contracts imply", () => {
    expect(CATALOG_CORE.edges).toEqual(edges);
  });

  test("the assembled catalog satisfies the language-neutral and Delivery contracts", async () => {
    const document = await loadCatalogDocument();
    expect(() => CatalogDocumentSchema.parse(document)).not.toThrow();
  });
});
