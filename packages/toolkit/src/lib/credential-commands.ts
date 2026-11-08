/** Which registered credentials each toolkit command needs. */

export const TEMPORAL_IN_CLUSTER_ADDRESS =
  "temporal-temporal-server-service:7233";

function flagValue(args: readonly string[], flag: string): string | undefined {
  const boundary = args.indexOf("--");
  const candidates = boundary === -1 ? args : args.slice(0, boundary);
  let value: string | undefined;
  for (const [index, argument] of candidates.entries()) {
    if (argument === flag) value = candidates[index + 1];
    if (argument.startsWith(`${flag}=`)) {
      value = argument.slice(flag.length + 1);
    }
  }
  return value;
}

function temporalCredentialsFor(
  environment: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
): readonly string[] {
  const address =
    flagValue(args, "--address") ?? environment["TEMPORAL_ADDRESS"];
  if (
    address !== TEMPORAL_IN_CLUSTER_ADDRESS &&
    flagValue(args, "--tls") === "false"
  ) {
    throw new Error(
      "toolkit: refusing to resolve TEMPORAL_API_KEY with --tls=false",
    );
  }
  return address === TEMPORAL_IN_CLUSTER_ADDRESS ? [] : ["TEMPORAL_API_KEY"];
}

export function requiredCredentialsFor(
  command: string,
  _subcommand: string | undefined,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  args: readonly string[] = [],
): readonly string[] {
  switch (command) {
    case "ci":
    case "woodpecker":
      return ["WOODPECKER_TOKEN"];
    case "temporal":
      return temporalCredentialsFor(environment, args);
    case "posthog":
      return ["POSTHOG_CLI_API_KEY"];
    case "argocd":
      return ["ARGOCD_AUTH_TOKEN"];
    case "grafana":
    case "prom":
    case "loki":
    case "tempo":
      return ["GRAFANA_API_KEY"];
    case "cf":
      return ["CF_API_TOKEN"];
    case "bugsink":
      return ["BUGSINK_TOKEN"];
    case "discord":
      return ["DISCORD_BOT_TOKEN", "DISCORD_USER_TOKEN"];
    case "pr":
      return ["WOODPECKER_TOKEN"];
    default:
      return [];
  }
}
