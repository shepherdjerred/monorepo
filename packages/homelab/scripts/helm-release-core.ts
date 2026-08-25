import path from "node:path";
import { Glob } from "bun";
import { parse as parseYaml, parseAllDocuments } from "yaml";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";

const BUILD_VERSION_RE = /^2\.0\.0-(\d+)$/;
const CONTENT_FINGERPRINT_ANNOTATION = "ci.sjer.red/content-fingerprint";
const REPOSITORY_CHART_URLS = new Set([
  "https://chartmuseum.tailnet-1a49.ts.net",
  "https://chartmuseum.sjer.red",
]);
// Charts whose release sync is allowed to remove live resources the chart no
// longer declares. Deliberately an allowlist: pruning is off for every other
// chart, so an accidental drop cannot delete anything.
//
// freshrss is here because #2317 renamed its Service
// (`freshrss-freshrss-service` -> `freshrss-service`). Without pruning the old
// Service survives undeclared, freshrss stays `Sync=OutOfSync Health=Healthy`
// forever, and `releaseHealthWait` fails every main build — it failed 10792.
// ArgoCD reports `requiresPruning` for that Service alone; both PVCs
// (`freshrss-data`, `freshrss-extensions`) are declared and are not candidates,
// so no data is at risk.
// temporal is here because the default Glitter worker was split into the
// corpus/context workers. The old worker's Services, Deployment, and
// ServiceMonitors are intentionally retired; leaving them live keeps the
// healthy temporal Application OutOfSync and blocks the release health wait.
const PRUNED_RELEASE_CHARTS = new Set([
  "freshrss",
  "media",
  "service-probes",
  "temporal",
  "turbo-cache",
]);

const ChartMuseumEntrySchema = z.object({
  version: z.string(),
  urls: z.array(z.string()).min(1),
  digest: z.string().regex(/^[a-f\d]{64}$/),
});

const ChartMetadataSchema = z.looseObject({
  apiVersion: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  appVersion: z.string().min(1),
  annotations: z.record(z.string(), z.string()).optional(),
});

export type ChartInput = {
  readonly name: string;
  readonly chartDirectory: string;
  readonly manifestPath: string;
  readonly fingerprint: string;
};

export type PublishedChart = {
  readonly version: string;
  readonly fingerprint: string;
};

export type ChartPlanEntry = {
  readonly name: string;
  readonly action: "publish" | "skip";
  readonly fingerprint: string;
  readonly baseVersion?: string;
};

export type HelmReleasePlan = {
  readonly selected: readonly ChartPlanEntry[];
  readonly skipped: readonly ChartPlanEntry[];
  readonly publishOrder: readonly string[];
};

export function releasePrunesChart(chartName: string): boolean {
  return PRUNED_RELEASE_CHARTS.has(chartName);
}

const KubernetesResourceSchema = z.looseObject({
  kind: z.string().optional(),
  metadata: z.looseObject({ name: z.string().min(1).optional() }).optional(),
});

const ArgoApplicationSchema = z.looseObject({
  kind: z.literal("Application"),
  metadata: z.looseObject({ name: z.string().min(1) }),
  spec: z.looseObject({
    source: z.looseObject({
      repoURL: z.string().min(1),
      chart: z.string().min(1).optional(),
    }),
  }),
});

const KubernetesListSchema = z.looseObject({
  kind: z.literal("List"),
  items: z.array(z.unknown()).optional(),
});

function applicationObjects(manifest: string): unknown[] {
  const applications: unknown[] = [];
  for (const [index, document] of parseAllDocuments(manifest).entries()) {
    if (document.errors.length > 0) {
      throw new Error(
        `Unable to parse synthesized manifest document ${index.toString()}: ${document.errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }
    const json = document.toJSON() as unknown;
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      continue;
    }
    const resource = KubernetesResourceSchema.parse(json);
    const resources =
      resource.kind === "List"
        ? (KubernetesListSchema.parse(json).items ?? [])
        : [json];
    for (const item of resources) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const itemResource = KubernetesResourceSchema.parse(item);
      if (itemResource.kind === "Application") {
        if (itemResource.metadata?.name === undefined) {
          throw new Error("Argo Application is missing metadata.name");
        }
        applications.push(item);
      }
    }
  }
  return applications;
}

function parsedApplications(manifest: string) {
  const applications = applicationObjects(manifest).map((value) =>
    ArgoApplicationSchema.parse(value),
  );
  const names = new Set<string>();
  for (const application of applications) {
    const name = application.metadata.name;
    if (names.has(name)) {
      throw new Error(
        `Duplicate Argo Application ${name} in synthesized manifest`,
      );
    }
    names.add(name);
  }
  return applications;
}

export function activeArgoApplicationNames(
  manifest: string,
): ReadonlySet<string> {
  return new Set(
    parsedApplications(manifest).map(
      (application) => application.metadata.name,
    ),
  );
}

export function activeArgoRepositoryChartNames(
  manifest: string,
): ReadonlySet<string> {
  return new Set(
    parsedApplications(manifest).flatMap((application) => {
      const { repoURL, chart } = application.spec.source;
      return chart !== undefined && REPOSITORY_CHART_URLS.has(repoURL)
        ? [chart]
        : [];
    }),
  );
}

async function regularFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Glob("**/*");
  for await (const relativePath of glob.scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    if (
      relativePath === "templates/.gitkeep" ||
      relativePath.endsWith(".tgz")
    ) {
      continue;
    }
    files.push(relativePath);
  }
  return files.sort();
}

function chartYamlValue(source: string, key: string): string {
  if (key !== "name" && key !== "version" && key !== "appVersion") {
    throw new Error(`Unsupported Chart.yaml scalar ${key}`);
  }
  const prefix = `${key}:`;
  const lines = source.split("\n").filter((line) => line.startsWith(prefix));
  if (lines.length !== 1 || lines[0] === undefined) {
    throw new Error(`Chart.yaml must declare scalar ${key} exactly once`);
  }
  const rawValue = lines[0].slice(prefix.length).trim();
  const value =
    rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;
  if (value === "" || value.includes('"')) {
    throw new Error(`Chart.yaml is missing scalar ${key}`);
  }
  return value;
}

function normalizedChartYaml(source: string): string {
  const metadata = ChartMetadataSchema.parse(parseYaml(source));
  const { annotations: sourceAnnotations, ...metadataWithoutAnnotations } =
    metadata;
  const annotations = Object.fromEntries(
    Object.entries(sourceAnnotations ?? {}).filter(
      ([key]) => key !== CONTENT_FINGERPRINT_ANNOTATION,
    ),
  );
  const normalized = {
    ...metadataWithoutAnnotations,
    version: "$version",
    appVersion: "$appVersion",
    ...(Object.keys(annotations).length === 0 ? {} : { annotations }),
  };
  return canonicalJson(normalized);
}

export async function fingerprintChart(
  chartDirectory: string,
  manifestPath: string,
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const generatedTemplatePath = path.join(
    "templates",
    path.basename(manifestPath),
  );
  for (const relativePath of await regularFiles(chartDirectory)) {
    if (relativePath === generatedTemplatePath) {
      continue;
    }
    const contents = await Bun.file(
      path.join(chartDirectory, relativePath),
    ).text();
    hasher.update(relativePath);
    hasher.update("\0");
    hasher.update(
      relativePath === "Chart.yaml" ? normalizedChartYaml(contents) : contents,
    );
    hasher.update("\0");
  }
  hasher.update(generatedTemplatePath);
  hasher.update("\0");
  hasher.update(await Bun.file(manifestPath).arrayBuffer());
  return `sha256:${hasher.digest("hex")}`;
}

export function verifyArchiveDigest(
  chartName: string,
  version: string,
  expectedDigest: string,
  archive: ArrayBuffer,
): void {
  const actualDigest = new Bun.CryptoHasher("sha256")
    .update(archive)
    .digest("hex");
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `${chartName}@${version}: ChartMuseum archive digest mismatch: expected ${expectedDigest}, actual ${actualDigest}`,
    );
  }
}

export async function discoverChartInputs(
  helmDirectory: string,
  synthDirectory: string,
): Promise<ChartInput[]> {
  const chartNames: string[] = [];
  const chartGlob = new Glob("*/Chart.yaml");
  for await (const chartYamlPath of chartGlob.scan(helmDirectory)) {
    chartNames.push(path.dirname(chartYamlPath));
  }
  chartNames.sort();

  const manifestNames: string[] = [];
  const manifestGlob = new Glob("*.k8s.yaml");
  for await (const manifestPath of manifestGlob.scan(synthDirectory)) {
    manifestNames.push(manifestPath.slice(0, -".k8s.yaml".length));
  }
  manifestNames.sort();

  const chartSet = new Set(chartNames);
  const manifestSet = new Set(manifestNames);
  const missingManifests = chartNames.filter((name) => !manifestSet.has(name));
  const orphanManifests = manifestNames.filter((name) => !chartSet.has(name));
  if (missingManifests.length > 0 || orphanManifests.length > 0) {
    throw new Error(
      [
        missingManifests.length === 0
          ? undefined
          : `Charts missing synthesized manifests: ${missingManifests.join(", ")}`,
        orphanManifests.length === 0
          ? undefined
          : `Synthesized manifests missing charts: ${orphanManifests.join(", ")}`,
      ]
        .filter((message) => message !== undefined)
        .join("\n"),
    );
  }

  return Promise.all(
    chartNames.map(async (name) => {
      const chartDirectory = path.join(helmDirectory, name);
      const chartYaml = await Bun.file(
        path.join(chartDirectory, "Chart.yaml"),
      ).text();
      const declaredName = chartYamlValue(chartYaml, "name");
      if (declaredName !== name) {
        throw new Error(
          `Chart directory ${name} declares Chart.yaml name ${declaredName}`,
        );
      }
      if (
        chartYamlValue(chartYaml, "version") !== "$version" ||
        chartYamlValue(chartYaml, "appVersion") !== "$appVersion"
      ) {
        throw new Error(
          `${name}/Chart.yaml must use literal $version and $appVersion placeholders`,
        );
      }
      const manifestPath = path.join(synthDirectory, `${name}.k8s.yaml`);
      const manifest = await Bun.file(manifestPath).text();
      if (manifest.trim() === "") {
        throw new Error(`Synthesized manifest is empty: ${manifestPath}`);
      }
      return {
        name,
        chartDirectory,
        manifestPath,
        fingerprint: await fingerprintChart(chartDirectory, manifestPath),
      };
    }),
  );
}

export function latestPublishedVersion(rawEntries: unknown):
  | {
      readonly version: string;
      readonly url: string;
      readonly digest: string;
    }
  | undefined {
  const entries = z.array(ChartMuseumEntrySchema).parse(rawEntries);
  const buildEntries = entries.flatMap((entry) => {
    const match = BUILD_VERSION_RE.exec(entry.version);
    if (match === null) {
      return [];
    }
    const buildNumber = Number.parseInt(match[1] ?? "", 10);
    return Number.isSafeInteger(buildNumber)
      ? [
          {
            version: entry.version,
            url: entry.urls[0] ?? "",
            digest: entry.digest,
            buildNumber,
          },
        ]
      : [];
  });
  buildEntries.sort((left, right) => right.buildNumber - left.buildNumber);
  const latest = buildEntries[0];
  return latest === undefined
    ? undefined
    : {
        version: latest.version,
        url: latest.url,
        digest: latest.digest,
      };
}

export function planCharts(
  inputs: readonly ChartInput[],
  published: ReadonlyMap<string, PublishedChart>,
): HelmReleasePlan {
  const entries = inputs.map((input): ChartPlanEntry => {
    const base = published.get(input.name);
    return {
      name: input.name,
      action: base?.fingerprint === input.fingerprint ? "skip" : "publish",
      fingerprint: input.fingerprint,
      ...(base === undefined ? {} : { baseVersion: base.version }),
    };
  });
  const leafChanged = entries.some(
    (entry) => entry.name !== "apps" && entry.action === "publish",
  );
  const coordinated = entries.map((entry): ChartPlanEntry =>
    leafChanged && entry.name === "apps"
      ? { ...entry, action: "publish" }
      : entry,
  );
  const selected = coordinated.filter((entry) => entry.action === "publish");
  const skipped = coordinated.filter((entry) => entry.action === "skip");
  return {
    selected,
    skipped,
    publishOrder: selected
      .map((entry) => entry.name)
      .sort((left, right) => {
        if (left === "apps") return 1;
        if (right === "apps") return -1;
        return left.localeCompare(right);
      }),
  };
}

export function plannedChartRevision(
  chartName: string,
  plan: HelmReleasePlan,
  version: string,
): string {
  const entry =
    plan.selected.find((item) => item.name === chartName) ??
    plan.skipped.find((item) => item.name === chartName);
  if (entry === undefined) {
    throw new Error(`No release plan entry for ${chartName}`);
  }
  if (entry.action === "publish") {
    return version;
  }
  if (entry.baseVersion === undefined) {
    throw new Error(`No exact chart revision available for ${chartName}`);
  }
  return entry.baseVersion;
}

export function assertReleaseNotStale(
  buildNumber: number,
  published: ReadonlyMap<string, PublishedChart>,
): void {
  for (const [chart, release] of published) {
    const match = BUILD_VERSION_RE.exec(release.version);
    if (match === null) {
      continue;
    }
    const publishedBuild = Number.parseInt(match[1] ?? "", 10);
    if (publishedBuild > buildNumber) {
      throw new Error(
        `Refusing stale Helm release ${buildNumber.toString()}: ${chart} already published ${release.version}`,
      );
    }
  }
}
