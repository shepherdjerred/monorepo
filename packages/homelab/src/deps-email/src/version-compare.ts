/**
 * Check if a version is in the range (oldVersion, newVersion]
 * i.e., greater than oldVersion and less than or equal to newVersion
 */
export function isVersionInRange(
  version: string,
  oldVersion: string,
  newVersion: string,
): boolean {
  const normalizedVersion = normalizeVersion(version);
  const normalizedOld = normalizeVersion(oldVersion);
  const normalizedNew = normalizeVersion(newVersion);

  return (
    compareVersions(normalizedVersion, normalizedOld) > 0 &&
    compareVersions(normalizedVersion, normalizedNew) <= 0
  );
}

/**
 * Check if v1 <= v2
 */
export function isVersionLessThanOrEqual(v1: string, v2: string): boolean {
  return compareVersions(normalizeVersion(v1), normalizeVersion(v2)) <= 0;
}

/**
 * Normalize version string (remove 'v' prefix, handle tags like 'chart-name-1.2.3')
 */
export function normalizeVersion(version: string): string {
  // Remove 'v' prefix
  let normalized = version.replace(/^v/, "");

  // Handle chart-name-version format (e.g., "grafana-10.3.0")
  const chartVersionRegex = /^[a-z-]+-(\d+\.\d+\.\d.*)$/i;
  const chartVersionMatch = chartVersionRegex.exec(normalized);
  if (chartVersionMatch?.[1] != null && chartVersionMatch[1] !== "") {
    normalized = chartVersionMatch[1];
  }

  return normalized;
}

/**
 * Compare two semver-ish versions
 * Returns: negative if v1 < v2, positive if v1 > v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(/[.-]/).map((p) => partToNumber(p));
  const parts2 = v2.split(/[.-]/).map((p) => partToNumber(p));

  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;

    if (p1 < p2) {
      return -1;
    }
    if (p1 > p2) {
      return 1;
    }
  }

  return 0;
}

/**
 * Convert a version part to a number for comparison
 */
function partToNumber(part: string): number {
  const num = Number.parseInt(part, 10);
  return Number.isNaN(num) ? 0 : num;
}
