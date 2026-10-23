#!/usr/bin/env bun
/**
 * Validate, content-plan, package, and publish repository Helm charts.
 *
 * A build version is publication identity, not a reason to publish. With the
 * Delivery catalog, the comparison base is the owner's latest qualified chart
 * and an unchanged chart is retained by reference; ChartMuseum supplies only
 * the version list (staleness) and this same producer's archive on a retry.
 * Changed leaves are published before the coordinating apps chart.
 */

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import { workerPoolTemplate } from "#cdk8s/scripts/delivery/worker-pool-template.ts";
import {
  CHARTMUSEUM_API,
  chartMuseumInventory,
  fetchPublishedArchive,
  planningBases,
  plannedFingerprint,
  retainCurrentProducerArchives,
  retainDeliveryChartBases,
  retainedChartRevisions,
  stagedChartFingerprint,
  validateChartProducerVersion,
  chartValidationValues,
  bindGeneratedDependencies,
  type ChartMuseumRelease,
  type ChartPlanningBase,
  type ChartPlanningClient,
} from "./helm-delivery-publication.ts";
import { chartPublicationImages } from "@shepherdjerred/root-scripts/lib/image-pin-catalog.ts";
import { requireEnv as requireEnvironment } from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  ChartPublicationSchema,
  type ChartPublication,
} from "@shepherdjerred/ops-model/chart-publication.ts";
import {
  assertReleaseNotStale,
  activeArgoRepositoryChartNames,
  discoverChartInputs,
  planCharts,
  plannedChartRevision,
  releasePrunesChart,
  type ChartInput,
  type HelmReleasePlan,
} from "./helm-release-core.ts";

const HELM_DIRECTORY = "src/cdk8s/helm";
const SYNTH_DIRECTORY = "src/cdk8s/dist";

type StagedChart = {
  readonly archive: string;
  readonly contentFingerprint: string;
};

function homelabRoot(): string {
  return new URL("../..", import.meta.url).pathname;
}

export async function runCommand(
  command: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<void> {
  const child = Bun.spawn([...command], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

export async function stageChart(
  input: ChartInput,
  version: string,
  temporaryDirectory: string,
): Promise<string> {
  const chartDirectory = path.join(temporaryDirectory, input.name);
  await runCommand(["mkdir", "-p", chartDirectory]);
  await runCommand(["cp", "-R", `${input.chartDirectory}/.`, chartDirectory]);
  const templatesDirectory = path.join(chartDirectory, "templates");
  await runCommand(["mkdir", "-p", templatesDirectory]);
  await Bun.write(
    path.join(templatesDirectory, `${input.name}.k8s.yaml`),
    workerPoolTemplate(await Bun.file(input.manifestPath).text(), input.name),
  );

  const chartYamlPath = path.join(chartDirectory, "Chart.yaml");
  const chartYaml = await Bun.file(chartYamlPath).text();
  const withVersion = chartYaml
    .replace(/^version:.*$/m, `version: "${version}"`)
    .replace(/^appVersion:.*$/m, `appVersion: "${version}"`);
  await Bun.write(chartYamlPath, `${withVersion.trimEnd()}\n`);
  const validationValues = chartValidationValues(input.name);
  const validationArguments: string[] = [];
  if (validationValues !== undefined) {
    const validationPath = path.join(
      temporaryDirectory,
      `${input.name}-validation.json`,
    );
    await Bun.write(validationPath, JSON.stringify(validationValues));
    validationArguments.push("--values", validationPath);
  }
  await runCommand([
    "helm",
    "lint",
    "--strict",
    chartDirectory,
    ...validationArguments,
  ]);
  await runCommand([
    "helm",
    "template",
    "release-validation",
    chartDirectory,
    ...validationArguments,
  ]);
  await runCommand([
    "helm",
    "package",
    chartDirectory,
    "--version",
    version,
    "--app-version",
    version,
    "--destination",
    temporaryDirectory,
  ]);
  return path.join(temporaryDirectory, `${input.name}-${version}.tgz`);
}

async function pushChart(
  chart: string,
  archive: string,
  username: string,
  password: string,
): Promise<void> {
  const response = await fetch(CHARTMUSEUM_API, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      "Content-Type": "application/octet-stream",
    },
    body: Bun.file(archive),
  });
  if (response.ok) {
    console.log(`${chart}: pushed (HTTP ${response.status.toString()})`);
    return;
  }
  const responseText = await response.text();
  const body = responseText.slice(0, 1024);
  throw new Error(
    `${chart}: ChartMuseum push failed (HTTP ${response.status.toString()}): ${body}`,
  );
}

function usage(): never {
  console.error(
    "Usage: bun packages/homelab/scripts/helm/helm-push.ts <build-number> [chart...] [--dry-run]",
  );
  process.exit(1);
}

function parseOptions(): {
  readonly buildNumber: string;
  readonly dryRun: boolean;
  readonly deliveryCatalog: boolean;
  readonly requested: ReadonlySet<string>;
} {
  const args = Bun.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const buildNumber = positional[0];
  if (buildNumber === undefined || !/^\d+$/.test(buildNumber)) {
    usage();
  }
  const requested = new Set(positional.slice(1));
  if (!dryRun && requested.size > 0) {
    throw new Error(
      "Selective production publication is unsafe: the content planner chooses the complete coordinated chart set",
    );
  }
  return {
    buildNumber,
    dryRun,
    requested,
    deliveryCatalog: args.includes("--delivery-catalog"),
  };
}

function planningClient(): ChartPlanningClient {
  return createDeliveryClient({
    baseUrl: requireEnvironment("DELIVERY_URL"),
    headers: {
      Authorization: `Bearer ${requireEnvironment("DELIVERY_API_TOKEN")}`,
    },
  });
}

function releasePlanningBases(
  inputs: readonly ChartInput[],
  options: {
    readonly version: string;
    readonly dryRun: boolean;
    readonly deliveryCatalog: boolean;
    readonly inventory: ReadonlyMap<string, ChartMuseumRelease>;
    readonly temporaryDirectory: string;
    readonly pipelineNumber: number | undefined;
  },
): Promise<ReadonlyMap<string, ChartPlanningBase>> {
  const { dryRun, deliveryCatalog, pipelineNumber } = options;
  return planningBases(inputs, {
    version: options.version,
    dryRun,
    deliveryCatalog,
    inventory: options.inventory,
    ...(pipelineNumber === undefined ? {} : { pipelineNumber }),
    archive: (name) => {
      const release = options.inventory.get(name);
      if (release === undefined) {
        throw new Error(`ChartMuseum has no published archive for ${name}`);
      }
      return fetchPublishedArchive(name, release, options.temporaryDirectory);
    },
    ...(dryRun || !deliveryCatalog ? {} : { client: planningClient() }),
  });
}

type RevisionInventoryOptions = {
  readonly activeRepositoryCharts: ReadonlySet<string>;
  readonly retainedRevisions: ReadonlyMap<string, string>;
};

function exactRevisionInventory(
  inputs: readonly ChartInput[],
  plan: HelmReleasePlan,
  version: string,
  options: RevisionInventoryOptions,
): Record<string, string> {
  const revisions: Record<string, string> = {};
  for (const input of inputs) {
    if (
      input.name === "apps" ||
      !options.activeRepositoryCharts.has(input.name)
    ) {
      continue;
    }
    const entry =
      plan.selected.find((item) => item.name === input.name) ??
      plan.skipped.find((item) => item.name === input.name);
    if (entry === undefined) {
      throw new Error(`No release plan entry for ${input.name}`);
    }
    const revision = entry.action === "publish" ? version : entry.baseVersion;
    if (revision === undefined) {
      throw new Error(`No exact chart revision available for ${input.name}`);
    }
    revisions[input.name] = revision;
  }
  for (const [chart, revision] of options.retainedRevisions) {
    revisions[chart] = revision;
  }
  return revisions;
}

async function stagePlannedCharts(
  names: readonly string[],
  options: {
    readonly scoped: readonly ChartInput[];
    readonly plan: HelmReleasePlan;
    readonly version: string;
    readonly temporaryDirectory: string;
  },
): Promise<Map<string, StagedChart>> {
  const { scoped, plan, version, temporaryDirectory } = options;
  const staged = new Map<string, StagedChart>();
  for (const name of names) {
    const input = scoped.find((candidate) => candidate.name === name);
    if (input === undefined) {
      throw new Error(`Release plan referenced unknown chart: ${name}`);
    }
    const archive = await stageChart(input, version, temporaryDirectory);
    const contentFingerprint = await stagedChartFingerprint(
      name,
      temporaryDirectory,
    );
    // The published fingerprint must be the key the planner compared, or
    // the next release can never retain these bytes.
    if (contentFingerprint !== plannedFingerprint(plan, name)) {
      throw new Error(
        `Staged chart ${name} differs from the content the release plan compared`,
      );
    }
    staged.set(name, { archive, contentFingerprint });
  }
  return staged;
}

async function publishPlannedCharts(
  plan: HelmReleasePlan,
  staged: ReadonlyMap<string, StagedChart>,
  publication: ChartPublication,
  version: string,
): Promise<void> {
  const username = requireEnvironment("CHARTMUSEUM_USERNAME");
  const password = requireEnvironment("CHARTMUSEUM_PASSWORD");
  for (const name of plan.publishOrder) {
    const chart = staged.get(name);
    if (chart === undefined) {
      throw new Error(`No staged archive for ${name}`);
    }
    await pushChart(name, chart.archive, username, password);
    publication.charts.push({
      name,
      revision: version,
      digest: `sha256:${createHash("sha256")
        .update(new Uint8Array(await Bun.file(chart.archive).arrayBuffer()))
        .digest("hex")}`,
      contentFingerprint: chart.contentFingerprint,
    });
  }
}

async function writeReleaseArtifacts(
  version: string,
  buildNumber: string,
  plan: HelmReleasePlan,
  revisions: Readonly<Record<string, string>>,
): Promise<void> {
  await Bun.write(
    path.join(process.cwd(), "helm-release-plan.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        build: { version, number: Number.parseInt(buildNumber, 10) },
        ...plan,
      },
      undefined,
      2,
    )}\n`,
  );
  await Bun.write(
    path.join(process.cwd(), "argocd-release-expected.json"),
    `${JSON.stringify(
      [
        {
          name: "apps",
          revision: plannedChartRevision("apps", plan, version),
        },
        ...Object.entries(revisions).map(([name, revision]) => ({
          name,
          revision,
          prune: releasePrunesChart(name),
        })),
      ],
      undefined,
      2,
    )}\n`,
  );
}

async function publicationImages(dryRun: boolean) {
  if (dryRun) return;
  const images = await chartPublicationImages();
  Bun.env["HOMELAB_IMAGE_DIGESTS_JSON"] = JSON.stringify(images);
  return images;
}

async function synthesizeCharts(
  root: string,
  imageInputs: Readonly<Record<string, string>> | undefined,
): Promise<ChartInput[]> {
  await runCommand(["bun", "--no-install", "run", "build"], {
    cwd: path.join(root, "src/cdk8s"),
  });
  await bindGeneratedDependencies(
    path.join(root, SYNTH_DIRECTORY),
    imageInputs,
  );
  return discoverChartInputs(
    path.join(root, HELM_DIRECTORY),
    path.join(root, SYNTH_DIRECTORY),
  );
}

async function main(): Promise<void> {
  const { buildNumber, dryRun, requested, deliveryCatalog } = parseOptions();
  const publication = dryRun
    ? undefined
    : ChartPublicationSchema.parse({
        schema: "delivery-chart-publications/v2",
        sourceRevision: requireEnvironment("CI_COMMIT_SHA"),
        pipelineNumber: Number(requireEnvironment("CI_PIPELINE_NUMBER")),
        repositoryId: Number(requireEnvironment("CI_REPO_ID")),
        charts: [],
        retained: [],
      });
  const version = `2.0.0-${buildNumber}`;
  validateChartProducerVersion(publication, buildNumber);
  const root = homelabRoot();
  const imageInputs = await publicationImages(dryRun);
  delete Bun.env["HOMELAB_CHART_REVISIONS_JSON"];
  const inputs = await synthesizeCharts(root, imageInputs);
  for (const chart of requested) {
    if (!inputs.some((input) => input.name === chart)) {
      throw new Error(`Unknown chart: ${chart}`);
    }
  }
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "homelab-helm-release-"),
  );
  try {
    const inventory = await chartMuseumInventory(inputs, dryRun);
    assertReleaseNotStale(Number.parseInt(buildNumber, 10), inventory);
    const planningBase = await releasePlanningBases(inputs, {
      version,
      dryRun,
      deliveryCatalog,
      inventory,
      temporaryDirectory,
      pipelineNumber: publication?.pipelineNumber,
    });
    const candidatePlan = planCharts(inputs, planningBase);
    const appsInput = inputs.find((input) => input.name === "apps");
    if (appsInput === undefined) {
      throw new Error("Release inputs are missing the apps chart");
    }
    const activeRepositoryCharts = activeArgoRepositoryChartNames(
      await Bun.file(appsInput.manifestPath).text(),
    );
    const revisions = exactRevisionInventory(inputs, candidatePlan, version, {
      activeRepositoryCharts,
      retainedRevisions: await retainedChartRevisions(
        activeRepositoryCharts,
        inputs,
      ),
    });
    Bun.env["HOMELAB_CHART_REVISIONS_JSON"] = JSON.stringify(revisions);
    const releaseInputs = await synthesizeCharts(root, imageInputs);
    const scoped =
      requested.size === 0
        ? releaseInputs
        : releaseInputs.filter((input) => requested.has(input.name));
    const plan = planCharts(releaseInputs, planningBase);
    retainCurrentProducerArchives(publication, planningBase, plan, version);
    if (deliveryCatalog) {
      retainDeliveryChartBases(publication, planningBase, plan, version);
    }
    await writeReleaseArtifacts(version, buildNumber, plan, revisions);
    const staged = await stagePlannedCharts(
      dryRun ? scoped.map((input) => input.name) : plan.publishOrder,
      { scoped, plan, version, temporaryDirectory },
    );
    if (dryRun) {
      console.log(`DRYRUN: validated ${staged.size.toString()} chart(s)`);
      return;
    }
    if (publication === undefined) {
      throw new Error(
        "Actual chart publication requires its original CI identity",
      );
    }
    if (plan.publishOrder.length === 0) {
      console.log("No chart content changed; publishing zero charts");
    } else {
      await publishPlannedCharts(plan, staged, publication, version);
    }
    await Bun.write(
      path.join(process.cwd(), "delivery-chart-publications.json"),
      JSON.stringify(ChartPublicationSchema.parse(publication)) + "\n",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
