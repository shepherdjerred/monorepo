const REGEX_VARIABLES = [
  "environment",
  "server",
  "instance",
  "repo",
  "schedule",
  "namespace",
  "device",
  "app",
  "provider",
  "kind",
  "source",
  "system_source",
  "status",
  "cluster",
  "serial",
  "volume",
] as const;

export function replaceGrafanaVariables(expression: string): string {
  let substituted = expression;
  for (const variable of REGEX_VARIABLES) {
    substituted = substituted.replaceAll(
      new RegExp(String.raw`\$\{?${variable}\}?`, "g"),
      ".*",
    );
  }
  return substituted
    .replaceAll(/\$\{?NAMESPACE\}?/g, "seaweedfs")
    .replaceAll("$__rate_interval", "5m")
    .replaceAll("$__interval", "5m");
}
