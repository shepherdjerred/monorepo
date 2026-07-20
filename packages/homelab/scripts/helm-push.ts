#!/usr/bin/env bun
/**
 * Package every Helm chart (or a named subset) and push it to ChartMuseum.
 *
 * Ported from the old CI's `helmSynthAndPackage` / `helmPushAllHelper` /
 * `helmPackageHelper` (.dagger/src/release.ts). Runs locally as a plain Bun
 * script; credentials come from the environment.
 *
 * Usage:
 *   bun packages/homelab/scripts/helm-push.ts <build-number> [chart...] [--dry-run]
 *
 * The chart version is `2.0.0-<build-number>` (matching the old scheme where
 * every build stamps a unique prerelease version so ChartMuseum pushes never
 * collide). With no chart args, all discovered charts are pushed.
 *
 * Env:
 *   CHARTMUSEUM_USERNAME, CHARTMUSEUM_PASSWORD — ChartMuseum basic-auth creds
 *     (required unless --dry-run)
 */

import { readdirSync, existsSync, rmSync } from "node:fs";
import { run, requireEnv, tmpBase } from "../../../scripts/lib/run.ts";

const CHARTMUSEUM_URL = "https://chartmuseum.sjer.red/api/charts";

/** homelab package root = two levels up from this script (packages/homelab). */
function homelabRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

const HELM_DIR_REL = "src/cdk8s/helm";
const CDK8S_DIR_REL = "src/cdk8s";
const SYNTH_DIST_REL = "src/cdk8s/dist";

/**
 * Discover chart names the way the old code's chart list did: every directory
 * under src/cdk8s/helm that contains a Chart.yaml is a chart. (The old catalog
 * hard-coded HELM_CHARTS, but that list is exactly the on-disk helm/ dirs, so
 * discovering them keeps the two from drifting.)
 */
function discoverCharts(root: string): string[] {
  const helmDir = `${root}/${HELM_DIR_REL}`;
  const entries = readdirSync(helmDir, { withFileTypes: true });
  const charts: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) {
      continue;
    }
    if (existsSync(`${helmDir}/${e.name}/Chart.yaml`)) {
      charts.push(e.name);
    }
  }
  return charts.sort();
}

/**
 * Synth cdk8s manifests if the dist output is missing. Produces
 * src/cdk8s/dist/<chart>.k8s.yaml for each chart, which helm package copies
 * into templates/.
 */
async function ensureSynth(root: string, dryRun: boolean): Promise<void> {
  const distDir = `${root}/${SYNTH_DIST_REL}`;
  // A synth is "present" if at least one manifest exists.
  const anyManifest = readdirSyncSafe(distDir).some((f) =>
    f.endsWith(".k8s.yaml"),
  );
  if (anyManifest) {
    console.log("cdk8s synth output present; skipping build");
    return;
  }
  console.log("+++ cdk8s synth (dist missing)");
  if (dryRun) {
    console.log("DRYRUN: would run `bun run build` in src/cdk8s");
    return;
  }
  await run(["bun", "run", "build"], { cwd: `${root}/${CDK8S_DIR_REL}` });
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // Directory absent yet — treated as "no synth output".
    return [];
  }
}

/**
 * Package one chart and push its .tgz to ChartMuseum. Mirrors the old
 * helmPackageHelper: copy the synth manifest into templates/, substitute the
 * version into Chart.yaml, `helm package`, then POST the tarball. A 409 means
 * an earlier push already landed that version (versions are unique per build),
 * so it counts as success.
 */
async function packageAndPush(opts: {
  root: string;
  chart: string;
  version: string;
  username: string;
  password: string;
  dryRun: boolean;
}): Promise<void> {
  const { root, chart, version, username, password, dryRun } = opts;
  const chartDir = `${root}/${HELM_DIR_REL}/${chart}`;
  const manifest = `${root}/${SYNTH_DIST_REL}/${chart}.k8s.yaml`;

  console.log(`--- ${chart} @ ${version}`);

  if (dryRun) {
    console.log(
      `DRYRUN: would copy ${chart}.k8s.yaml into templates/, ` +
        `helm package --version ${version} --app-version ${version}, ` +
        `and POST ${chart}-${version}.tgz to ChartMuseum`,
    );
    return;
  }

  if (!(await Bun.file(manifest).exists())) {
    throw new Error(
      `Synth manifest missing for chart ${chart}: ${manifest}. ` +
        `Run the cdk8s build first.`,
    );
  }

  // Copy the synth manifest into the chart's templates/ dir.
  await run(["mkdir", "-p", `${chartDir}/templates`]);
  await run(["cp", manifest, `${chartDir}/templates/${chart}.k8s.yaml`]);

  // Substitute $version / $appVersion placeholders in Chart.yaml, then package.
  // Chart.yaml ships with literal "$version"/"$appVersion" placeholders.
  const chartYamlPath = `${chartDir}/Chart.yaml`;
  const chartYaml = await Bun.file(chartYamlPath).text();
  await Bun.write(
    chartYamlPath,
    chartYaml
      .replaceAll("$version", version)
      .replaceAll("$appVersion", version),
  );

  await run(
    ["helm", "package", ".", "--version", version, "--app-version", version],
    { cwd: chartDir },
  );

  const tgz = `${chart}-${version}.tgz`;
  console.log(`push: ${tgz} -> ChartMuseum`);
  // curl with basic auth; a 2xx or 409 (already exists) is success. The response
  // body goes to a temp file, NOT `/dev/stderr`: on Linux `/dev/stderr` is
  // `/proc/self/fd/2`, and curl reopening it fails with error 23 ("client
  // returned ERROR on write") whenever the parent has piped stderr rather than
  // inheriting a plain fd (which `run` now does to capture diagnostics). The
  // temp file also lets us fold ChartMuseum's error body into the thrown error.
  const bodyFile = `${tmpBase()}/helm-push-${chart}-${version}.body`;
  const result = await run(
    [
      "curl",
      "-sS",
      "-o",
      bodyFile,
      "-w",
      "%{http_code}",
      "--connect-timeout",
      "15",
      "--max-time",
      "120",
      "-u",
      `${username}:${password}`,
      "--data-binary",
      `@${chartDir}/${tgz}`,
      CHARTMUSEUM_URL,
    ],
    { capture: true },
  );
  const code = result.stdout.trim();
  const body = (await Bun.file(bodyFile).text()).trim();
  // curl has exited and the contents are in `body`; drop the temp file so it
  // can't accumulate. `force` tolerates an already-absent file; any other error
  // (e.g. permissions) still surfaces rather than being silently swallowed.
  rmSync(bodyFile, { force: true });
  if (code.startsWith("2")) {
    console.log(`${chart}: pushed (HTTP ${code})`);
    return;
  }
  if (code === "409") {
    console.log(`${chart}: already exists (HTTP 409) — treating as success`);
    return;
  }
  throw new Error(
    `${chart}: ChartMuseum push failed (HTTP ${code})${body === "" ? "" : `: ${body}`}`,
  );
}

function usage(): never {
  console.error(
    "Usage: bun packages/homelab/scripts/helm-push.ts <build-number> " +
      "[chart...] [--dry-run]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
  }
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  const buildNumber = positional[0];
  if (buildNumber === undefined) {
    console.error("A build number is required (chart version = 2.0.0-<n>).");
    usage();
  }
  const version = `2.0.0-${buildNumber}`;

  const root = homelabRoot();
  const allCharts = discoverCharts(root);
  const requested = positional.slice(1);
  const charts = requested.length > 0 ? requested : allCharts;

  // Validate any explicitly-requested charts exist.
  for (const c of requested) {
    if (!allCharts.includes(c)) {
      throw new Error(
        `Unknown chart: ${c}. Known charts: ${allCharts.join(", ")}`,
      );
    }
  }

  console.log(
    `Pushing ${charts.length.toString()} chart(s) @ ${version}` +
      (dryRun ? " (dry run)" : ""),
  );

  await ensureSynth(root, dryRun);

  const username = dryRun ? "" : requireEnv("CHARTMUSEUM_USERNAME");
  const password = dryRun ? "" : requireEnv("CHARTMUSEUM_PASSWORD");

  for (const chart of charts) {
    await packageAndPush({
      root,
      chart,
      version,
      username,
      password,
      dryRun,
    });
  }

  console.log(`--- done: ${charts.length.toString()} chart(s)`);
}

await main();
