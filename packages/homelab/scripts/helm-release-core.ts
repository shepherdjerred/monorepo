import path from "node:path";
import { Glob } from "bun";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";

const BUILD_VERSION_RE = /^2\.0\.0-(\d+)$/;
const CONTENT_FINGERPRINT_ANNOTATION = "ci.sjer.red/content-fingerprint";

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

async function regularFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Glob("**/*");
  for await (const relativePath of glob.scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    if (
      relativePath.endsWith(".tgz") ||
      relativePath === "templates/.gitkeep"
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
  const coordinated = entries.map(
    (entry): ChartPlanEntry =>
      entry.name === "apps" && leafChanged
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
