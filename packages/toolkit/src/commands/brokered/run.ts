import {
  resolveCredentialValues,
  withoutServiceAccountToken,
} from "#lib/credentials.ts";
import type { CredentialDeps } from "#lib/credentials.ts";
import { spawnForwardingSignals } from "#lib/spawn-forwarding.ts";

/**
 * `toolkit run --env NAME[,NAME…] -- <command> [args…]`: run one command with
 * the named credentials in its environment and nowhere else. The replacement
 * for `with-service-account.sh op run`, whose child also inherits the
 * service-account token.
 */

const USAGE = "Usage: toolkit run --env NAME[,NAME...] -- <command> [args...]";

export type RunInvocation = {
  readonly names: readonly string[];
  readonly command: readonly string[];
};

export function parseRunArguments(
  args: readonly string[],
): RunInvocation | string {
  const boundary = args.indexOf("--");
  if (boundary === -1) return USAGE;
  const command = args.slice(boundary + 1);
  if (command.length === 0) return USAGE;
  const names: string[] = [];
  const options = args.slice(0, boundary);
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    let list: string | undefined;
    if (option === "--env") {
      list = options[index + 1];
      index += 1;
    } else if (option?.startsWith("--env=") === true) {
      list = option.slice("--env=".length);
    } else {
      return `toolkit: unknown option ${String(option)}\n${USAGE}`;
    }
    if (list === undefined || list.length === 0) return USAGE;
    names.push(...list.split(",").filter((name) => name.length > 0));
  }
  return names.length === 0 ? USAGE : { names, command };
}

export async function runWithCredentials(
  args: readonly string[],
  deps?: CredentialDeps,
): Promise<number> {
  const parsed = parseRunArguments(args);
  if (typeof parsed === "string") {
    console.error(parsed);
    return 2;
  }
  const [program, ...rest] = parsed.command;
  if (program === undefined) {
    console.error(USAGE);
    return 2;
  }
  const executable = Bun.which(program);
  if (executable === null) {
    console.error(`toolkit: command not found: ${program}`);
    return 127;
  }
  const values = await resolveCredentialValues(parsed.names, deps);
  return spawnForwardingSignals([executable, ...rest], {
    env: { ...withoutServiceAccountToken(Bun.env), ...values },
  });
}
