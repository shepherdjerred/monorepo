#!/usr/bin/env bun
/**
 * Validate, content-plan, package, and publish repository Helm charts.
 *
 * A build version is publication identity, not a reason to publish. The
 * comparison base is ChartMuseum's newest published 2.0.0-N chart, regardless
 * of whether the producing CI build later passed, failed, or was
 * canceled. Changed leaves are published before the coordinating apps chart.
 */

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { workerPoolTemplate } from "#cdk8s/scripts/delivery/worker-pool-template.ts";
import {
  deliveryPlanningBase,
  retainCurrentProducerArchives,
  validateChartProducerVersion,
  chartValidationValues,
  bindGeneratedDependencies,
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
  fingerprintChart,
  latestPublishedVersion,
  planCharts,
  plannedChartRevision,
  releasePrunesChart,
  verifyArchiveDigest,
  type ChartInput,
  type PublishedChart,
} from "./helm-release-core.ts";

const CHARTMUSEUM_ORIGIN = "https://chartmuseum.sjer.red";
const CHARTMUSEUM_API = `${CHARTMUSEUM_ORIGIN}/api/charts`;
const HELM_DIRECTORY = "src/cdk8s/helm";
const SYNTH_DIRECTORY = "src/cdk8s/dist";

function homelabRoot(): string {
  return new URL("../..", import.meta.url).pathname;
}

async function runCommand(
  command: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<void> {
  const child = Bun.spawn([...command], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
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

async function fetchPublishedChart(
  input: ChartInput,
  temporaryDirectory: string,
): Promise<PublishedChart | undefined> {
  const response = await fetch(
    `${CHARTMUSEUM_API}/${encodeURIComponent(input.name)}`,
  );
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(
      `ChartMuseum inventory failed for ${input.name}: HTTP ${response.status.toString()}`,
    );
  }
  const latest = latestPublishedVersion(await response.json());
  if (latest === undefined) {
    return undefined;
  }

  const archiveResponse = await fetch(new URL(latest.url, CHARTMUSEUM_ORIGIN));
  if (!archiveResponse.ok) {
    throw new Error(
      `ChartMuseum download failed for ${input.name}@${latest.version}: HTTP ${archiveResponse.status.toString()}`,
    );
  }
  const archiveBytes = await archiveResponse.arrayBuffer();
  verifyArchiveDigest(input.name, latest.version, latest.digest, archiveBytes);
  const archive = path.join(
    temporaryDirectory,
    `${input.name}-${latest.version}.tgz`,
  );
  await Bun.write(archive, archiveBytes);
  const extracted = path.join(
    temporaryDirectory,
    `${input.name}-${latest.version}`,
  );
  await runCommand(["mkdir", "-p", extracted]);
  await runCommand(["tar", "-xzf", archive, "-C", extracted]);
  const chartDirectory = path.join(extracted, input.name);
  const actualFingerprint = await fingerprintChart(
    chartDirectory,
    path.join(chartDirectory, "templates", `${input.name}.k8s.yaml`),
  );
  return {
    version: latest.version,
    fingerprint: actualFingerprint,
    digest: `sha256:${latest.digest}`,
  };
}

async function fetchLatestPublishedRevision(
  chartName: string,
): Promise<string> {
  const response = await fetch(
    `${CHARTMUSEUM_API}/${encodeURIComponent(chartName)}`,
  );
  if (!response.ok) {
    throw new Error(
      `ChartMuseum inventory failed for ${chartName}: HTTP ${response.status.toString()}`,
    );
  }
  const latest = latestPublishedVersion(await response.json());
  if (latest === undefined) {
    throw new Error(
      `ChartMuseum has no published build revision for ${chartName}`,
    );
  }
  return latest.version;
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

async function publishedInventory(
  inputs: readonly ChartInput[],
  dryRun: boolean,
  temporaryDirectory: string,
): Promise<Map<string, PublishedChart>> {
  const published = new Map<string, PublishedChart>();
  if (dryRun) {
    return published;
  }
  const bases = await Promise.all(
    inputs.map(async (input) => ({
      name: input.name,
      published: await fetchPublishedChart(input, temporaryDirectory),
    })),
  );
  for (const base of bases) {
    if (base.published !== undefined) {
      published.set(base.name, base.published);
    }
  }
  return published;
}

type RevisionInventoryOptions = {
  readonly activeRepositoryCharts: ReadonlySet<string>;
  readonly retainedRevisions: ReadonlyMap<string, string>;
};

function exactRevisionInventory(
  inputs: readonly ChartInput[],
  plan: ReturnType<typeof planCharts>,
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

async function writeReleaseArtifacts(
  version: string,
  buildNumber: string,
  plan: ReturnType<typeof planCharts>,
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

async function main(): Promise<void> {
  const { buildNumber, dryRun, requested, deliveryCatalog } = parseOptions();
  const publication = dryRun
    ? undefined
    : ChartPublicationSchema.parse({
        schema: "delivery-chart-publications/v1",
        sourceRevision: requireEnvironment("CI_COMMIT_SHA"),
        pipelineNumber: Number(requireEnvironment("CI_PIPELINE_NUMBER")),
        repositoryId: Number(requireEnvironment("CI_REPO_ID")),
        charts: [],
      });
  const version = `2.0.0-${buildNumber}`;
  validateChartProducerVersion(publication, buildNumber);
  const root = homelabRoot();
  const imageInputs = await publicationImages(dryRun);
  delete Bun.env["HOMELAB_CHART_REVISIONS_JSON"];
  await runCommand(["bun", "--no-install", "run", "build"], {
    cwd: path.join(root, "src/cdk8s"),
  });
  await bindGeneratedDependencies(
    path.join(root, SYNTH_DIRECTORY),
    imageInputs,
  );
  const inputs = await discoverChartInputs(
    path.join(root, HELM_DIRECTORY),
    path.join(root, SYNTH_DIRECTORY),
  );
  for (const chart of requested) {
    if (!inputs.some((input) => input.name === chart)) {
      throw new Error(`Unknown chart: ${chart}`);
    }
  }
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "homelab-helm-release-"),
  );
  try {
    const published = await publishedInventory(
      inputs,
      dryRun,
      temporaryDirectory,
    );
    assertReleaseNotStale(Number.parseInt(buildNumber, 10), published);
    const planningBase = deliveryPlanningBase(
      published,
      version,
      deliveryCatalog,
    );
    const candidatePlan = planCharts(inputs, planningBase);
    const appsInput = inputs.find((input) => input.name === "apps");
    if (appsInput === undefined) {
      throw new Error("Release inputs are missing the apps chart");
    }
    const activeRepositoryCharts = activeArgoRepositoryChartNames(
      await Bun.file(appsInput.manifestPath).text(),
    );
    const localChartNames = new Set(inputs.map((input) => input.name));
    const retainedCharts = [...activeRepositoryCharts].filter(
      (chart) => !localChartNames.has(chart),
    );
    const retainedRevisions = new Map(
      await Promise.all(
        retainedCharts.map(
          async (chart) =>
            [chart, await fetchLatestPublishedRevision(chart)] as const,
        ),
      ),
    );
    const revisions = exactRevisionInventory(inputs, candidatePlan, version, {
      activeRepositoryCharts,
      retainedRevisions,
    });
    Bun.env["HOMELAB_CHART_REVISIONS_JSON"] = JSON.stringify(revisions);
    await runCommand(["bun", "--no-install", "run", "build"], {
      cwd: path.join(root, "src/cdk8s"),
    });
    await bindGeneratedDependencies(
      path.join(root, SYNTH_DIRECTORY),
      imageInputs,
    );
    const releaseInputs = await discoverChartInputs(
      path.join(root, HELM_DIRECTORY),
      path.join(root, SYNTH_DIRECTORY),
    );
    const scoped =
      requested.size === 0
        ? releaseInputs
        : releaseInputs.filter((input) => requested.has(input.name));
    const plan = planCharts(releaseInputs, planningBase);
    retainCurrentProducerArchives(publication, published, plan, version);
    await writeReleaseArtifacts(version, buildNumber, plan, revisions);
    const plannedNames = dryRun
      ? scoped.map((input) => input.name)
      : plan.publishOrder;
    const staged = new Map<string, string>();
    for (const name of plannedNames) {
      const input = scoped.find((candidate) => candidate.name === name);
      if (input === undefined) {
        throw new Error(`Release plan referenced unknown chart: ${name}`);
      }
      staged.set(name, await stageChart(input, version, temporaryDirectory));
    }
    if (dryRun) {
      console.log(`DRYRUN: validated ${staged.size.toString()} chart(s)`);
      return;
    }
    if (plan.publishOrder.length === 0) {
      await writePublication(publication);
      console.log("No chart content changed; publishing zero charts");
      return;
    }
    const username = requireEnvironment("CHARTMUSEUM_USERNAME");
    const password = requireEnvironment("CHARTMUSEUM_PASSWORD");
    for (const name of plan.publishOrder) {
      const archive = staged.get(name);
      if (archive === undefined) {
        throw new Error(`No staged archive for ${name}`);
      }
      await pushChart(name, archive, username, password);
      publication?.charts.push({
        name,
        revision: version,
        digest: `sha256:${createHash("sha256")
          .update(new Uint8Array(await Bun.file(archive).arrayBuffer()))
          .digest("hex")}`,
      });
    }
    await writePublication(publication);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function writePublication(publication: ChartPublication | undefined) {
  if (publication === undefined)
    throw new Error(
      "Actual chart publication requires its original CI identity",
    );
  await Bun.write(
    path.join(process.cwd(), "delivery-chart-publications.json"),
    JSON.stringify(ChartPublicationSchema.parse(publication)) + "\n",
  );
}

if (import.meta.main) await main();
