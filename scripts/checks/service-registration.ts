#!/usr/bin/env bun
/**
 * Service registration completeness.
 *
 * A hosted first-party service is registered in about a dozen places outside
 * its own package. The service catalog
 * (`packages/ops-model/catalog-document.json`) is the registry of record;
 * this check walks every catalog service that ships a first-party image or
 * chart and asserts each of the other places agrees:
 *
 * - image: `image-registry.json`, a build target in
 *   `ci/scripts/images/image-targets.ts`, a `docker-bake.hcl` target, and a
 *   smoke stage (plus an in-image smoke command for application images);
 * - chart: `packages/homelab/src/cdk8s/helm/<chart>/Chart.yaml` and a Delivery
 *   recipe that deploys it;
 * - environments: `packages/delivery/registrations/v2/<env>/recipe.json`;
 * - Delivery delegations: `legacy.deliveryDelegations` equals the reviewed
 *   policy in `packages/homelab/src/delivery-target-policy.ts`;
 * - the owning package is a root workspace.
 *
 * On failure it prints the missing items as a checklist. Real, reviewed gaps
 * are named in `service-registration-exemptions.json`, each with its reason;
 * an exemption that no longer applies fails the check:
 *
 * - `imagesBuiltOutsideBake`: first-party images built by the CI-image
 *   pipeline (`ci/scripts/images/build-ci-image.ts`), not by the application
 *   bake. They are registered in `image-registry.json` only.
 * - `chartsWithoutRecipe`: first-party charts no Delivery recipe deploys, such
 *   as a prepared service's inactive chart.
 * - `policyOnlyDelegations`: Applications the reviewed Delivery policy names
 *   that the catalog's `legacy.deliveryDelegations` does not.
 *
 * Every input is read from the given root except the Delivery policy and the
 * environment renames, which are this checkout's modules.
 */
import path from "node:path";
import { z } from "zod";
import { catalogEnvironmentOf } from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";
import {
  ORDINARY_DELIVERY_ENVIRONMENTS,
  SPECIALIZED_DELIVERY_ENVIRONMENTS,
} from "../../packages/homelab/src/delivery-target-policy.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..");

const CATALOG = "packages/ops-model/catalog-document.json";
const IMAGE_REGISTRY = "packages/version-catalog/src/image-registry.json";
const IMAGE_TARGETS = "ci/scripts/images/image-targets.ts";
const BAKE_FILE = "docker-bake.hcl";
const SMOKE_COMMANDS = "ci/scripts/images/smoke-app-in-image.ts";
const HELM_ROOT = "packages/homelab/src/cdk8s/helm";
const RECIPE_ROOT = "packages/delivery/registrations/v2";
const DELIVERY_POLICY = "packages/homelab/src/delivery-target-policy.ts";
export const EXEMPTIONS = "scripts/checks/service-registration-exemptions.json";

const ExemptionsSchema = z.strictObject({
  imagesBuiltOutsideBake: z.record(z.string(), z.string()),
  chartsWithoutRecipe: z.record(z.string(), z.string()),
  policyOnlyDelegations: z.record(z.string(), z.string()),
});

const ImageTargetsSchema = z.looseObject({
  IMAGE_TARGET_REGISTRY: z.record(z.string(), z.unknown()),
  INFRASTRUCTURE_IMAGE_TARGETS: z.array(z.string()),
});

const CatalogSchema = z.looseObject({
  services: z.array(
    z.looseObject({
      id: z.string(),
      package: z.string().optional(),
      components: z
        .array(z.looseObject({ name: z.string(), producer: z.string() }))
        .default([]),
    }),
  ),
  environments: z.array(z.looseObject({ id: z.string() })),
  legacy: z.looseObject({
    deliveryDelegations: z.record(z.string(), z.string()),
  }),
});

const ImageRegistrySchema = z.looseObject({
  images: z.array(z.looseObject({ name: z.string() })),
});

const RootPackageSchema = z.looseObject({ workspaces: z.array(z.string()) });

export type CatalogService = {
  id: string;
  package?: string | undefined;
  /** First-party image component names, without the `image:` prefix. */
  images: readonly string[];
  /** First-party chart component names, without the `chart:` prefix. */
  charts: readonly string[];
};

/** A bake target as far as this check reads it. */
export type BakeTarget = {
  /** Repository-relative Dockerfile path. */
  dockerfile: string;
  hasSmokeStage: boolean;
};

export type RegistrationInputs = {
  services: readonly CatalogService[];
  environments: readonly string[];
  /** Argo Application to the (possibly pre-cutover) environment id it is delegated to. */
  deliveryDelegations: Readonly<Record<string, string>>;
  /** The catalog environment a delegation's environment id names today. */
  catalogEnvironmentOf: (environmentId: string) => string;
  registryImages: ReadonlySet<string>;
  applicationTargets: ReadonlySet<string>;
  infrastructureTargets: ReadonlySet<string>;
  bakeTargets: ReadonlyMap<string, BakeTarget>;
  smokeCommands: ReadonlySet<string>;
  helmCharts: ReadonlySet<string>;
  /** Environment ids that have a committed `recipe.json`. */
  recipeEnvironments: ReadonlySet<string>;
  /** Chart names some committed recipe deploys. */
  recipeCharts: ReadonlySet<string>;
  policyDelegations: Readonly<Record<string, string>>;
  workspaces: ReadonlySet<string>;
  exemptions: {
    imagesBuiltOutsideBake: Readonly<Record<string, string>>;
    chartsWithoutRecipe: Readonly<Record<string, string>>;
    policyOnlyDelegations: Readonly<Record<string, string>>;
  };
};

export type Finding = {
  /** Catalog service id, or `catalog` for a repository-wide item. */
  subject: string;
  /** What to do, phrased as one checklist line. */
  item: string;
};

function imageFindings(
  service: CatalogService,
  inputs: RegistrationInputs,
): Finding[] {
  const findings: Finding[] = [];
  const missing = (item: string) => {
    findings.push({ subject: service.id, item });
  };
  for (const image of service.images) {
    if (!inputs.registryImages.has(image))
      missing(`image:${image}: add it to ${IMAGE_REGISTRY}`);
    if (image in inputs.exemptions.imagesBuiltOutsideBake) continue;

    const application = inputs.applicationTargets.has(image);
    if (!application && !inputs.infrastructureTargets.has(image))
      missing(
        `image:${image}: register it in ${IMAGE_TARGETS} (IMAGE_TARGET_REGISTRY or INFRASTRUCTURE_IMAGE_TARGETS)`,
      );
    const target = inputs.bakeTargets.get(image);
    if (target === undefined) {
      missing(`image:${image}: add target "${image}" to ${BAKE_FILE}`);
      continue;
    }
    if (!target.hasSmokeStage)
      missing(`image:${image}: add a \`smoke\` stage to ${target.dockerfile}`);
    if (application && !inputs.smokeCommands.has(image))
      missing(
        `image:${image}: add an in-image smoke command to ${SMOKE_COMMANDS}`,
      );
  }
  return findings;
}

function chartFindings(
  service: CatalogService,
  inputs: RegistrationInputs,
): Finding[] {
  const findings: Finding[] = [];
  const missing = (item: string) => {
    findings.push({ subject: service.id, item });
  };
  for (const chart of service.charts) {
    if (!inputs.helmCharts.has(chart))
      missing(`chart:${chart}: add ${HELM_ROOT}/${chart}/Chart.yaml`);
    if (
      !inputs.recipeCharts.has(chart) &&
      !(chart in inputs.exemptions.chartsWithoutRecipe)
    )
      missing(
        `chart:${chart}: no recipe under ${RECIPE_ROOT} deploys it; register an environment and run \`bun run --cwd packages/homelab/src/cdk8s generate:catalog\``,
      );
  }
  return findings;
}

function serviceFindings(
  service: CatalogService,
  inputs: RegistrationInputs,
): Finding[] {
  const findings = [
    ...imageFindings(service, inputs),
    ...chartFindings(service, inputs),
  ];
  for (const environment of inputs.environments)
    if (
      environment.startsWith(`${service.id}/`) &&
      !inputs.recipeEnvironments.has(environment)
    )
      findings.push({
        subject: service.id,
        item: `environment ${environment}: add ${RECIPE_ROOT}/${environment}/recipe.json (\`generate:catalog\`)`,
      });
  if (
    service.package !== undefined &&
    !inputs.workspaces.has(`packages/${service.package}`)
  )
    findings.push({
      subject: service.id,
      item: `package ${service.package}: add packages/${service.package} to the root package.json workspaces`,
    });
  return findings;
}

function delegationFindings(inputs: RegistrationInputs): Finding[] {
  const findings: Finding[] = [];
  const catalog = (item: string) => {
    findings.push({ subject: "catalog", item });
  };
  const environments = new Set(inputs.environments);
  const { policyOnlyDelegations } = inputs.exemptions;

  for (const [application, environment] of Object.entries(
    inputs.deliveryDelegations,
  )) {
    const current = inputs.catalogEnvironmentOf(environment);
    if (!environments.has(current))
      catalog(
        `delegation ${application}: ${current} is not a catalog environment`,
      );
    const policy = inputs.policyDelegations[application];
    if (policy === undefined)
      catalog(
        `delegation ${application}: add it to ${DELIVERY_POLICY} as ${environment}`,
      );
    else if (policy !== environment)
      catalog(
        `delegation ${application}: ${CATALOG} says ${environment} but ${DELIVERY_POLICY} says ${policy}`,
      );
  }
  for (const [application, environment] of Object.entries(
    inputs.policyDelegations,
  ))
    if (
      inputs.deliveryDelegations[application] === undefined &&
      !(application in policyOnlyDelegations)
    )
      catalog(
        `delegation ${application}: add it to legacy.deliveryDelegations in ${CATALOG} as ${environment}`,
      );
  return findings;
}

/** An exemption that names nothing real hides the next gap; fail on it. */
function staleExemptionFindings(inputs: RegistrationInputs): Finding[] {
  const findings: Finding[] = [];
  const stale = (table: string, key: string, why: string) => {
    findings.push({
      subject: "exemptions",
      item: `${table}["${key}"]: ${why}; delete the exemption from ${EXEMPTIONS}`,
    });
  };
  const images = new Set(inputs.services.flatMap((service) => service.images));
  const charts = new Set(inputs.services.flatMap((service) => service.charts));
  const { exemptions } = inputs;

  for (const image of Object.keys(exemptions.imagesBuiltOutsideBake)) {
    if (!images.has(image))
      stale("imagesBuiltOutsideBake", image, "not a first-party catalog image");
    else if (inputs.bakeTargets.has(image))
      stale("imagesBuiltOutsideBake", image, "it has a bake target now");
  }
  for (const chart of Object.keys(exemptions.chartsWithoutRecipe)) {
    if (!charts.has(chart))
      stale("chartsWithoutRecipe", chart, "not a first-party catalog chart");
    else if (inputs.recipeCharts.has(chart))
      stale("chartsWithoutRecipe", chart, "a recipe deploys it now");
  }
  for (const application of Object.keys(exemptions.policyOnlyDelegations)) {
    if (inputs.policyDelegations[application] === undefined)
      stale(
        "policyOnlyDelegations",
        application,
        "the Delivery policy no longer names it",
      );
    else if (inputs.deliveryDelegations[application] !== undefined)
      stale(
        "policyOnlyDelegations",
        application,
        "the catalog delegates it now",
      );
  }
  return findings;
}

export function registrationFindings(inputs: RegistrationInputs): Finding[] {
  const catalogImages = new Set(
    inputs.services.flatMap((service) => service.images),
  );
  const orphans: Finding[] = [
    ...[...inputs.registryImages]
      .filter((image) => !catalogImages.has(image))
      .map((image) => ({
        subject: "catalog",
        item: `image ${image} is in ${IMAGE_REGISTRY} but no catalog service has a first-party image:${image} component`,
      })),
    ...[...inputs.applicationTargets, ...inputs.infrastructureTargets]
      .filter((image) => !catalogImages.has(image))
      .map((image) => ({
        subject: "catalog",
        item: `image ${image} is a build target in ${IMAGE_TARGETS} but no catalog service has a first-party image:${image} component`,
      })),
  ];
  return [
    ...inputs.services.flatMap((service) => serviceFindings(service, inputs)),
    ...orphans,
    ...delegationFindings(inputs),
    ...staleExemptionFindings(inputs),
  ];
}

/** The findings as a checklist grouped by subject. */
export function formatChecklist(findings: readonly Finding[]): string {
  const bySubject = new Map<string, string[]>();
  for (const { subject, item } of findings)
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), item]);
  return [...bySubject]
    .map(
      ([subject, items]) =>
        `${subject}\n${items.map((item) => `  [ ] ${item}`).join("\n")}`,
    )
    .join("\n\n");
}

/**
 * The `target "<name>" { ... }` blocks of a bake file with the Dockerfile
 * each one builds. Targets whose name starts with `_` are templates.
 */
export function parseBakeTargets(
  bake: string,
): Map<string, { dockerfile: string }> {
  const targets = new Map<string, { dockerfile: string }>();
  for (const match of bake.matchAll(/^target "([^"]+)" \{\n(.*?)^\}/gmsu)) {
    const [, name, body] = match;
    if (name === undefined || body === undefined || name.startsWith("_"))
      continue;
    const context = /^\s*context\s*=\s*"([^"]+)"/mu.exec(body)?.[1] ?? ".";
    const dockerfile =
      /^\s*dockerfile\s*=\s*"([^"]+)"/mu.exec(body)?.[1] ?? "Dockerfile";
    targets.set(name, { dockerfile: path.join(context, dockerfile) });
  }
  return targets;
}

/** Keys of the `commands` table in the in-image smoke harness. */
export function parseSmokeCommands(source: string): Set<string> {
  const table = /^const commands:.+?^\};/msu.exec(source)?.[0] ?? "";
  return new Set(
    [...table.matchAll(/^ {2}"?([a-z0-9-]+)"?: \{$/gmu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
}

/** Every `chartComponent` in a recipe, including a compound recipe's parts. */
export function recipeChartComponents(value: unknown): string[] {
  if (Array.isArray(value))
    return value.flatMap((item) => recipeChartComponents(item));
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  return record.success
    ? Object.entries(record.data).flatMap(([key, child]) =>
        key === "chartComponent" && typeof child === "string"
          ? [child]
          : recipeChartComponents(child),
      )
    : [];
}

function componentsOf(
  components: readonly { name: string; producer: string }[],
  kind: string,
): string[] {
  return components
    .filter(
      ({ name, producer }) =>
        producer === "first-party" && name.startsWith(`${kind}:`),
    )
    .map(({ name }) => name.slice(kind.length + 1));
}

async function readText(root: string, file: string): Promise<string> {
  return Bun.file(path.join(root, file)).text();
}

async function readJson(root: string, file: string): Promise<unknown> {
  return JSON.parse(await readText(root, file));
}

export async function loadRegistrationInputs(
  root: string = REPOSITORY_ROOT,
): Promise<RegistrationInputs> {
  const catalog = CatalogSchema.parse(await readJson(root, CATALOG));
  const registry = ImageRegistrySchema.parse(
    await readJson(root, IMAGE_REGISTRY),
  );
  const rootPackage = RootPackageSchema.parse(
    await readJson(root, "package.json"),
  );
  const exemptions = ExemptionsSchema.parse(await readJson(root, EXEMPTIONS));
  // The build-target tables are code; load the given root's copy of them.
  const imageTargets = ImageTargetsSchema.parse(
    await import(path.join(root, IMAGE_TARGETS)),
  );

  const bakeTargets = new Map<string, BakeTarget>();
  for (const [name, { dockerfile }] of parseBakeTargets(
    await readText(root, BAKE_FILE),
  )) {
    const file = Bun.file(path.join(root, dockerfile));
    bakeTargets.set(name, {
      dockerfile,
      hasSmokeStage:
        (await file.exists()) &&
        /^FROM \S+ AS smoke$/imu.test(await file.text()),
    });
  }

  const helmCharts = await Array.fromAsync(
    new Bun.Glob("*/Chart.yaml").scan({ cwd: path.join(root, HELM_ROOT) }),
  );
  const recipeFiles = await Array.fromAsync(
    new Bun.Glob("**/recipe.json").scan({ cwd: path.join(root, RECIPE_ROOT) }),
  );
  const recipes = await Promise.all(
    recipeFiles.map((file) => readJson(root, path.join(RECIPE_ROOT, file))),
  );

  return {
    services: catalog.services
      .map((service) => ({
        id: service.id,
        package: service.package,
        images: componentsOf(service.components, "image"),
        charts: componentsOf(service.components, "chart"),
      }))
      .filter(
        (service) => service.images.length > 0 || service.charts.length > 0,
      ),
    environments: catalog.environments.map((environment) => environment.id),
    deliveryDelegations: catalog.legacy.deliveryDelegations,
    catalogEnvironmentOf,
    registryImages: new Set(registry.images.map((image) => image.name)),
    applicationTargets: new Set(
      Object.keys(imageTargets.IMAGE_TARGET_REGISTRY),
    ),
    infrastructureTargets: new Set(imageTargets.INFRASTRUCTURE_IMAGE_TARGETS),
    bakeTargets,
    smokeCommands: parseSmokeCommands(await readText(root, SMOKE_COMMANDS)),
    helmCharts: new Set(helmCharts.map((file) => path.dirname(file))),
    recipeEnvironments: new Set(recipeFiles.map((file) => path.dirname(file))),
    recipeCharts: new Set(
      recipes
        .flatMap((recipe) => recipeChartComponents(recipe))
        .filter((component) => component.startsWith("chart:"))
        .map((component) => component.slice("chart:".length)),
    ),
    policyDelegations: {
      ...ORDINARY_DELIVERY_ENVIRONMENTS,
      ...SPECIALIZED_DELIVERY_ENVIRONMENTS,
    },
    workspaces: new Set(rootPackage.workspaces),
    exemptions,
  };
}

if (import.meta.main) {
  const findings = registrationFindings(await loadRegistrationInputs());
  if (findings.length > 0) {
    console.error(
      `Service registration is incomplete (${String(findings.length)} item(s)):\n\n${formatChecklist(findings)}`,
    );
    process.exit(1);
  }
  console.log("Service registration is complete.");
}
