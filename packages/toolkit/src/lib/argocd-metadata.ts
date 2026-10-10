const BOOLEAN_OPTIONS = new Set([
  "--core",
  "--grpc-web",
  "--insecure",
  "--plaintext",
  "--port-forward",
  "--prompts-enabled",
]);
const VALUE_OPTIONS = new Set([
  "--config",
  "--server",
  "--server-crt",
  "--client-crt",
  "--client-crt-key",
  "--auth-token",
  "--grpc-web-root-path",
  "--logformat",
  "--loglevel",
  "--header",
  "-H",
  "--port-forward-namespace",
  "--http-retry-max",
  "--argocd-context",
  "--server-name",
  "--controller-name",
  "--redis-haproxy-name",
  "--redis-name",
  "--repo-server-name",
  "--redis-compress",
  "--kube-context",
]);

/** Remove inherited options and their values, respecting the payload boundary. */
function commandArguments(args: readonly string[]): string[] {
  const commands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) throw new Error("Missing ArgoCD argument");
    if (argument === "--") return [...commands, ...args.slice(index)];
    const name = argument.split("=", 1)[0] ?? argument;
    if (BOOLEAN_OPTIONS.has(name)) continue;
    if (VALUE_OPTIONS.has(name)) {
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (argument.startsWith("-H") && argument.length > 2) continue;
    commands.push(argument);
  }
  return commands;
}

export function isArgoHelpCommand(args: readonly string[]): boolean {
  const commands = commandArguments(args);
  if (
    commands[0] === "help" ||
    (commands[0] === "--" && commands[1] === "help")
  )
    return true;
  let help = false;
  for (const argument of commands) {
    if (argument === "--") break;
    if (/^(?:--help|-h)(?:=(?:[1tT]|true|TRUE|True))?$/u.test(argument)) {
      help = true;
    } else if (/^(?:--help|-h)=(?:[0fF]|false|FALSE|False)$/u.test(argument)) {
      help = false;
    } else if (argument.startsWith("-")) {
      // Unknown command-specific flags may consume a following --help value.
      return false;
    }
  }
  return help;
}
