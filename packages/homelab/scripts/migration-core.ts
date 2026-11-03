export function setChartVersion(source: string, version: string): string {
  const withVersion = source.replace(/^version:.*$/m, `version: ${version}`);
  return withVersion.replace(/^appVersion:.*$/m, `appVersion: ${version}`);
}

export function chartName(chartPath: string): string {
  return chartPath.replace(/\/$/, "").split("/").at(-1) ?? chartPath;
}
