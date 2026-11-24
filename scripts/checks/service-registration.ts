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
 *   policy in `packages/homelab/src/delivery-target-policy.ts`. That policy
 *   derives from this checkout's catalog plus its pending delegations, so
 *   here the comparison holds each pending delegation to its exemption; for
 *   another root it compares that root's catalog with this checkout's policy;
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
const RevisionRecordSchema = z.record(z.string(), z.unknown());

export function nextRevisionId(revisionId: string): string {
  const match = /^(.+)\/(\d+)$/u.exec(revisionId);
  return match?.[1] === undefined || match[2] === undefined
    ? `${revisionId}/2`
    : `${match[1]}/${String(Number(match[2]) + 1)}`;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => canonicalJsonValue(item));
  if (typeof value !== "object" || value === null) return value;
  const record = RevisionRecordSchema.parse(value);
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((key) => [key, canonicalJsonValue(record[key])]),
  );
}

function splitRevisionJson(raw: unknown) {
  const { id, ...rest } = RevisionRecordSchema.parse(raw);
  return {
    id: typeof id === "string" ? id : undefined,
    payloadKey: JSON.stringify(canonicalJsonValue(rest)),
  };
}

function runGit(
  root: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { exitCode: number; stdout: string } {
  const res = Bun.spawnSync(["git", ...args], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: res.exitCode, stdout: res.stdout.toString("utf8") };
}

export function resolveImmutableRevisionBase(
  root: string = REPOSITORY_ROOT,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): string | undefined {
  const req = env["CI_CHANGED_BASE"]?.trim();
  const baseRef = req !== undefined && req.length > 0 ? req : "origin/main";
  for (const args of [
    ["merge-base", baseRef, "HEAD"],
    ["rev-parse", "--verify", "HEAD"],
  ] as const) {
    const res = runGit(root, args, env);
    if (res.exitCode === 0 && res.stdout.trim().length > 0)
      return res.stdout.trim();
  }
  return undefined;
}

export async function immutableRevisionFindings(
  options: {
    root?: string;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<Finding[]> {
  const root = options.root ?? REPOSITORY_ROOT;
  const env = options.env ?? Bun.env;
  const base = resolveImmutableRevisionBase(root, env);
  if (base === undefined) return [];
  const diff = runGit(
    root,
    ["diff", "--name-only", base, "--", RECIPE_ROOT],
    env,
  );
  if (diff.exitCode !== 0) return [];
  const findings: Finding[] = [];
  const pattern =
    /^packages\/delivery\/registrations\/v2\/(.+)\/(recipe|configuration)\.json$/u;
  for (const rel of diff.stdout
    .split("\n")
    .map((s) => s.trim())
    .toSorted()) {
    const m = pattern.exec(rel);
    if (m?.[1] === undefined || m[2] === undefined) continue;
    const file = Bun.file(path.join(root, rel));
    if (!(await file.exists())) continue;
    const blob = runGit(root, ["show", `${base}:${rel}`], env);
    if (blob.exitCode !== 0) continue;
    const baseRev = splitRevisionJson(JSON.parse(blob.stdout));
    const currRev = splitRevisionJson(JSON.parse(await file.text()));
    if (baseRev.id === undefined || currRev.id !== baseRev.id) continue;
    if (currRev.payloadKey === baseRev.payloadKey) continue;
    const field =
      m[2] === "recipe" ? "recipeRevisionId" : "configurationRevisionId";
    findings.push({
      subject: m[1],
      item: `${rel}: immutable ${m[2]} revision "${baseRev.id}" changed in place relative to ${base.slice(0, 12)}; bump "id" and ${field} in ${CATALOG} to "${nextRevisionId(baseRev.id)}"`,
    });
  }
  return findings;
}

export type CatalogService = {
  id: string;
  package?: string | undefined;
  images: readonly string[];
  charts: readonly string[];
};

export type BakeTarget = { dockerfile: string; hasSmokeStage: boolean };

export type RegistrationInputs = {
  services: readonly CatalogService[];
  environments: readonly string[];
  deliveryDelegations: Readonly<Record<string, string>>;
  catalogEnvironmentOf: (environmentId: string) => string;
  registryImages: ReadonlySet<string>;
  applicationTargets: ReadonlySet<string>;
  infrastructureTargets: ReadonlySet<string>;
  bakeTargets: ReadonlyMap<string, BakeTarget>;
  smokeCommands: ReadonlySet<string>;
  helmCharts: ReadonlySet<string>;
  recipeEnvironments: ReadonlySet<string>;
  recipeCharts: ReadonlySet<string>;
  policyDelegations: Readonly<Record<string, string>>;
  workspaces: ReadonlySet<string>;
  exemptions: {
    imagesBuiltOutsideBake: Readonly<Record<string, string>>;
    chartsWithoutRecipe: Readonly<Record<string, string>>;
    policyOnlyDelegations: Readonly<Record<string, string>>;
  };
};

export type Finding = { subject: string; item: string };

function imageFindings(
  s: CatalogService,
  inputs: RegistrationInputs,
): Finding[] {
  const findings: Finding[] = [];
  const missing = (item: string) => findings.push({ subject: s.id, item });
  for (const img of s.images) {
    if (!inputs.registryImages.has(img))
      missing(`image:${img}: add it to ${IMAGE_REGISTRY}`);
    if (img in inputs.exemptions.imagesBuiltOutsideBake) continue;
    const app = inputs.applicationTargets.has(img);
    if (!app && !inputs.infrastructureTargets.has(img))
      missing(
        `image:${img}: register it in ${IMAGE_TARGETS} (IMAGE_TARGET_REGISTRY or INFRASTRUCTURE_IMAGE_TARGETS)`,
      );
    const target = inputs.bakeTargets.get(img);
    if (target === undefined) {
      missing(`image:${img}: add target "${img}" to ${BAKE_FILE}`);
      continue;
    }
    if (!target.hasSmokeStage)
      missing(`image:${img}: add a \`smoke\` stage to ${target.dockerfile}`);
    if (app && !inputs.smokeCommands.has(img))
      missing(
        `image:${img}: add an in-image smoke command to ${SMOKE_COMMANDS}`,
      );
  }
  return findings;
}

function serviceFindings(
  s: CatalogService,
  inputs: RegistrationInputs,
): Finding[] {
  const findings = imageFindings(s, inputs);
  const missing = (item: string) => findings.push({ subject: s.id, item });
  for (const ch of s.charts) {
    if (!inputs.helmCharts.has(ch))
      missing(`chart:${ch}: add ${HELM_ROOT}/${ch}/Chart.yaml`);
    if (
      !inputs.recipeCharts.has(ch) &&
      !(ch in inputs.exemptions.chartsWithoutRecipe)
    )
      missing(
        `chart:${ch}: no recipe under ${RECIPE_ROOT} deploys it; register an environment and run \`bun run --cwd packages/homelab/src/cdk8s generate:catalog\``,
      );
  }
  for (const env of inputs.environments)
    if (env.startsWith(`${s.id}/`) && !inputs.recipeEnvironments.has(env))
      missing(
        `environment ${env}: add ${RECIPE_ROOT}/${env}/recipe.json (\`generate:catalog\`)`,
      );
  if (
    s.package !== undefined &&
    !inputs.workspaces.has(`packages/${s.package}`)
  )
    missing(
      `package ${s.package}: add packages/${s.package} to the root package.json workspaces`,
    );
  return findings;
}

function delegationFindings(inputs: RegistrationInputs): Finding[] {
  const findings: Finding[] = [];
  const catalog = (item: string) => findings.push({ subject: "catalog", item });
  const envs = new Set(inputs.environments);
  for (const [app, env] of Object.entries(inputs.deliveryDelegations)) {
    const current = inputs.catalogEnvironmentOf(env);
    if (!envs.has(current))
      catalog(`delegation ${app}: ${current} is not a catalog environment`);
    const policy = inputs.policyDelegations[app];
    if (policy === undefined)
      catalog(`delegation ${app}: add it to ${DELIVERY_POLICY} as ${env}`);
    else if (policy !== env)
      catalog(
        `delegation ${app}: ${CATALOG} says ${env} but ${DELIVERY_POLICY} says ${policy}`,
      );
  }
  for (const [app, env] of Object.entries(inputs.policyDelegations))
    if (
      inputs.deliveryDelegations[app] === undefined &&
      !(app in inputs.exemptions.policyOnlyDelegations)
    )
      catalog(
        `delegation ${app}: add it to legacy.deliveryDelegations in ${CATALOG} as ${env}`,
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
  const images = new Set(inputs.services.flatMap((s) => s.images));
  const charts = new Set(inputs.services.flatMap((s) => s.charts));
  const { exemptions } = inputs;
  for (const img of Object.keys(exemptions.imagesBuiltOutsideBake)) {
    if (!images.has(img))
      stale("imagesBuiltOutsideBake", img, "not a first-party catalog image");
    else if (inputs.bakeTargets.has(img))
      stale("imagesBuiltOutsideBake", img, "it has a bake target now");
  }
  for (const ch of Object.keys(exemptions.chartsWithoutRecipe)) {
    if (!charts.has(ch))
      stale("chartsWithoutRecipe", ch, "not a first-party catalog chart");
    else if (inputs.recipeCharts.has(ch))
      stale("chartsWithoutRecipe", ch, "a recipe deploys it now");
  }
  for (const app of Object.keys(exemptions.policyOnlyDelegations)) {
    if (inputs.policyDelegations[app] === undefined)
      stale(
        "policyOnlyDelegations",
        app,
        "the Delivery policy no longer names it",
      );
    else if (inputs.deliveryDelegations[app] !== undefined)
      stale("policyOnlyDelegations", app, "the catalog delegates it now");
  }
  return findings;
}

export function registrationFindings(inputs: RegistrationInputs): Finding[] {
  const catalogImages = new Set(inputs.services.flatMap((s) => s.images));
  const orphan = (image: string, where: string): Finding => ({
    subject: "catalog",
    item: `image ${image} is ${where} but no catalog service has a first-party image:${image} component`,
  });
  return [
    ...inputs.services.flatMap((service) => serviceFindings(service, inputs)),
    ...[...inputs.registryImages]
      .filter((img) => !catalogImages.has(img))
      .map((img) => orphan(img, `in ${IMAGE_REGISTRY}`)),
    ...[...inputs.applicationTargets, ...inputs.infrastructureTargets]
      .filter((img) => !catalogImages.has(img))
      .map((img) => orphan(img, `a build target in ${IMAGE_TARGETS}`)),
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
    .map(([s, items]) => `${s}\n${items.map((i) => `  [ ] ${i}`).join("\n")}`)
    .join("\n\n");
}

/** The `target "<name>" { ... }` blocks of a bake file, skipping `_` templates. */
export function parseBakeTargets(
  bake: string,
): Map<string, { dockerfile: string }> {
  const targets = new Map<string, { dockerfile: string }>();
  for (const [, name, body] of bake.matchAll(
    /^target "([^"]+)" \{\n(.*?)^\}/gmsu,
  )) {
    if (name === undefined || body === undefined || name.startsWith("_"))
      continue;
    const ctx = /^\s*context\s*=\s*"([^"]+)"/mu.exec(body)?.[1] ?? ".";
    const df =
      /^\s*dockerfile\s*=\s*"([^"]+)"/mu.exec(body)?.[1] ?? "Dockerfile";
    targets.set(name, { dockerfile: path.join(ctx, df) });
  }
  return targets;
}

/** Keys of the `commands` table in the in-image smoke harness. */
export function parseSmokeCommands(source: string): Set<string> {
  const table = /^const commands:.+?^\};/msu.exec(source)?.[0] ?? "";
  return new Set(
    [...table.matchAll(/^ {2}"?([a-z0-9-]+)"?: \{$/gmu)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    ),
  );
}

/** Every `chartComponent` in a recipe, including a compound recipe's parts. */
export function recipeChartComponents(value: unknown): string[] {
  if (Array.isArray(value))
    return value.flatMap((v) => recipeChartComponents(v));
  const rec = RevisionRecordSchema.safeParse(value);
  return rec.success
    ? Object.entries(rec.data).flatMap(([k, v]) =>
        k === "chartComponent" && typeof v === "string"
          ? [v]
          : recipeChartComponents(v),
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

const readText = (root: string, file: string) =>
  Bun.file(path.join(root, file)).text();
const readJson = async (root: string, file: string): Promise<unknown> =>
  JSON.parse(await readText(root, file));

export async function loadRegistrationInputs(
  root: string = REPOSITORY_ROOT,
): Promise<RegistrationInputs> {
  const [
    catalogRaw,
    registryRaw,
    pkgRaw,
    exemptionsRaw,
    imageTargets,
    bakeText,
    smokeText,
  ] = await Promise.all([
    readJson(root, CATALOG),
    readJson(root, IMAGE_REGISTRY),
    readJson(root, "package.json"),
    readJson(root, EXEMPTIONS),
    import(path.join(root, IMAGE_TARGETS)).then((mod: unknown) =>
      ImageTargetsSchema.parse(mod),
    ),
    readText(root, BAKE_FILE),
    readText(root, SMOKE_COMMANDS),
  ]);
  const catalog = CatalogSchema.parse(catalogRaw);
  const registry = ImageRegistrySchema.parse(registryRaw);
  const rootPackage = RootPackageSchema.parse(pkgRaw);
  const exemptions = ExemptionsSchema.parse(exemptionsRaw);
  const bakeTargets = new Map<string, BakeTarget>();
  for (const [name, { dockerfile }] of parseBakeTargets(bakeText)) {
    const file = Bun.file(path.join(root, dockerfile));
    bakeTargets.set(name, {
      dockerfile,
      hasSmokeStage:
        (await file.exists()) &&
        /^FROM \S+ AS smoke$/imu.test(await file.text()),
    });
  }
  const [helmCharts, recipeFiles] = await Promise.all([
    Array.fromAsync(
      new Bun.Glob("*/Chart.yaml").scan({ cwd: path.join(root, HELM_ROOT) }),
    ),
    Array.fromAsync(
      new Bun.Glob("**/recipe.json").scan({
        cwd: path.join(root, RECIPE_ROOT),
      }),
    ),
  ]);
  const recipes = await Promise.all(
    recipeFiles.map((file) => readJson(root, path.join(RECIPE_ROOT, file))),
  );
  return {
    services: catalog.services
      .map((s) => ({
        id: s.id,
        package: s.package,
        images: componentsOf(s.components, "image"),
        charts: componentsOf(s.components, "chart"),
      }))
      .filter((s) => s.images.length > 0 || s.charts.length > 0),
    environments: catalog.environments.map((e) => e.id),
    deliveryDelegations: catalog.legacy.deliveryDelegations,
    catalogEnvironmentOf,
    registryImages: new Set(registry.images.map((i) => i.name)),
    applicationTargets: new Set(
      Object.keys(imageTargets.IMAGE_TARGET_REGISTRY),
    ),
    infrastructureTargets: new Set(imageTargets.INFRASTRUCTURE_IMAGE_TARGETS),
    bakeTargets,
    smokeCommands: parseSmokeCommands(smokeText),
    helmCharts: new Set(helmCharts.map((file) => path.dirname(file))),
    recipeEnvironments: new Set(recipeFiles.map((file) => path.dirname(file))),
    recipeCharts: new Set(
      recipes
        .flatMap((r) => recipeChartComponents(r))
        .filter((c) => c.startsWith("chart:"))
        .map((c) => c.slice("chart:".length)),
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
  const [inputs, revisionFindings] = await Promise.all([
    loadRegistrationInputs(),
    immutableRevisionFindings(),
  ]);
  const findings = [...registrationFindings(inputs), ...revisionFindings];
  if (findings.length > 0) {
    console.error(
      `Service registration is incomplete (${String(findings.length)} item(s)):\n\n${formatChecklist(findings)}`,
    );
    process.exit(1);
  }
  console.log("Service registration is complete.");
}
