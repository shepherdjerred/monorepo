#!/usr/bin/env bun
/**
 * Validate, content-plan, package, and publish repository Helm charts.
 *
 * A build version is publication identity, not a reason to publish. The
 * comparison base is ChartMuseum's newest published 2.0.0-N chart, regardless
 * of whether the producing Buildkite build later passed, failed, or was
 * canceled. Changed leaves are published before the coordinating apps chart.
 */

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  assertReleaseNotStale,
  discoverChartInputs,
  fingerprintChart,
  latestPublishedVersion,
  planCharts,
  plannedChartRevision,
  verifyArchiveDigest,
  type ChartInput,
  type PublishedChart,
} from "./helm-release-core.ts";

const CHARTMUSEUM_ORIGIN = "https://chartmuseum.sjer.red";
const CHARTMUSEUM_API = `${CHARTMUSEUM_ORIGIN}/api/charts`;
const HELM_DIRECTORY = "src/cdk8s/helm";
const SYNTH_DIRECTORY = "src/cdk8s/dist";

function homelabRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

function requireEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable is missing: ${name}`);
  }
  return value;
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
  return { version: latest.version, fingerprint: actualFingerprint };
}

async function stageChart(
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
    Bun.file(input.manifestPath),
  );

  const chartYamlPath = path.join(chartDirectory, "Chart.yaml");
  const chartYaml = await Bun.file(chartYamlPath).text();
  const withVersion = chartYaml
    .replace(/^version:.*$/m, `version: "${version}"`)
    .replace(/^appVersion:.*$/m, `appVersion: "${version}"`);
  await Bun.write(chartYamlPath, `${withVersion.trimEnd()}\n`);
  await runCommand(["helm", "lint", "--strict", chartDirectory]);
  await runCommand(["helm", "template", "release-validation", chartDirectory]);
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
    "Usage: bun packages/homelab/scripts/helm-push.ts <build-number> [chart...] [--dry-run]",
  );
  process.exit(1);
}

function parseOptions(): {
  readonly buildNumber: string;
  readonly dryRun: boolean;
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
  return { buildNumber, dryRun, requested };
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

function exactRevisionInventory(
  inputs: readonly ChartInput[],
  plan: ReturnType<typeof planCharts>,
  version: string,
): Record<string, string> {
  const revisions: Record<string, string> = {};
  for (const input of inputs) {
    if (input.name === "apps") {
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
          prune: name === "service-probes" || name === "turbo-cache",
        })),
      ],
      undefined,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  const { buildNumber, dryRun, requested } = parseOptions();
  const version = `2.0.0-${buildNumber}`;
  const root = homelabRoot();
  // First synth applies current-build image overrides while child chart
  // revisions are still floating. That content plan determines which leaves
  // receive this release version. A second synth below injects those exact
  // revisions into the coordinating apps chart.
  delete Bun.env["HOMELAB_CHART_REVISIONS_JSON"];
  await runCommand(["bun", "--no-install", "run", "build"], {
    cwd: path.join(root, "src/cdk8s"),
  });
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
    const candidatePlan = planCharts(inputs, published);
    const revisions = exactRevisionInventory(inputs, candidatePlan, version);
    Bun.env["HOMELAB_CHART_REVISIONS_JSON"] = JSON.stringify(revisions);
    await runCommand(["bun", "--no-install", "run", "build"], {
      cwd: path.join(root, "src/cdk8s"),
    });
    const releaseInputs = await discoverChartInputs(
      path.join(root, HELM_DIRECTORY),
      path.join(root, SYNTH_DIRECTORY),
    );
    const scoped =
      requested.size === 0
        ? releaseInputs
        : releaseInputs.filter((input) => requested.has(input.name));
    const plan = planCharts(releaseInputs, published);
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
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
