let sweepsEnabled = true;

export function setDatabaseMetricSweepsEnabled(enabled: boolean): void {
  sweepsEnabled = enabled;
}

export function databaseMetricSweepsEnabled(): boolean {
  return sweepsEnabled;
}
