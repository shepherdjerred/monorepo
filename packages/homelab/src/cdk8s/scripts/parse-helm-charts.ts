/**
 * Parse Helm chart information from versions.ts for the cdk8s application.
 * This is specific to the cdk8s project structure and not part of the helm-types library.
 */

export type ChartInfo = {
  name: string;
  repoUrl: string;
  version: string;
  chartName: string; // The actual chart name (may differ from versions.ts key)
  oci?: boolean; // Served from an OCI registry (helm pull oci://...)
};

/**
 * versions.ts keys whose `datasource=docker` renovate entry is actually an OCI
 * Helm chart (not a plain container image). renovate models OCI charts as the
 * docker datasource, so this allowlist is the only reliable way to tell the two
 * apart. Keep in sync with the OCI ArgoCD applications.
 */
const OCI_CHART_KEYS = new Set(["kueue", "agent-stack-k8s"]);

/**
 * The version value is usually on the key line (`key: "x"`), but long pins
 * (digest-suffixed OCI versions) get wrapped onto the following line by
 * prettier. Check the key line first, then the line after it. The `@sha256:...`
 * digest is stripped — helm --version wants the bare semver.
 */
function extractVersion(
  keyLine: string,
  lineAfter: string,
): string | undefined {
  const raw =
    /:\s*"([^"]+)"/.exec(keyLine)?.[1] ?? /^\s*"([^"]+)"/.exec(lineAfter)?.[1];
  const version = raw?.split("@")[0];
  return version === "" ? undefined : version;
}

/**
 * Parse a single chart entry (a renovate comment line + the version-key line(s)
 * that follow it). Returns null for non-chart lines and plain container images.
 */
function parseChartEntry(
  commentLine: string,
  keyLine: string,
  lineAfter: string,
): ChartInfo | null {
  const isHelm = commentLine.includes("renovate: datasource=helm");
  const versionKey = /^\s*"?([^":\s]+)"?:/.exec(keyLine)?.[1];
  const isOciChart =
    commentLine.includes("renovate: datasource=docker") &&
    versionKey != null &&
    OCI_CHART_KEYS.has(versionKey);

  // Only HTTP-repo helm charts and known OCI charts; skip plain images.
  if ((!isHelm && !isOciChart) || versionKey == null) {
    return null;
  }

  const repoUrl = /registryUrl=(\S+)/.exec(commentLine)?.[1];
  const version = extractVersion(keyLine, lineAfter);
  if (repoUrl == null || repoUrl === "" || version == null) {
    return null;
  }

  if (isOciChart) {
    // OCI: the chart artifact path is the renovate packageName, served from the
    // registryUrl (strip the https:// renovate requires on the comment).
    const packageName = /packageName=(\S+)/.exec(commentLine)?.[1];
    if (packageName == null || packageName === "") {
      return null;
    }
    return {
      name: versionKey,
      repoUrl: repoUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      version,
      chartName: packageName,
      oci: true,
    };
  }

  return {
    name: versionKey,
    repoUrl: repoUrl.replace(/\/$/, ""), // Remove trailing slash
    version,
    // chartName matches the version key (incl. "argo-cd").
    chartName: versionKey,
  };
}

/**
 * Parse chart information from versions.ts comments and values
 */
export async function parseChartInfoFromVersions(
  versionsPath = "src/versions.ts",
): Promise<ChartInfo[]> {
  const content = await Bun.file(versionsPath).text();
  const lines = content.split("\n");
  const charts: ChartInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    if (line == null || nextLine == null || nextLine === "") {
      continue;
    }
    const chart = parseChartEntry(line, nextLine, lines[i + 2] ?? "");
    if (chart != null) {
      charts.push(chart);
    }
  }

  return charts;
}
