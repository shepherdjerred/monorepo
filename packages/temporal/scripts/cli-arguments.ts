export function requiredArgument(
  args: readonly string[],
  flag: string,
): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseFlagArguments(
  args: readonly string[],
  allowedFlags: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (flag?.startsWith("--") !== true) {
      throw new Error(`Unexpected positional argument ${flag ?? "<missing>"}`);
    }
    if (!allowedFlags.has(flag)) {
      throw new Error(`Unknown argument ${flag}`);
    }
    if (parsed.has(flag)) {
      throw new Error(`Duplicate argument ${flag}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    parsed.set(flag, value);
  }
  return parsed;
}

export function requiredParsedArgument(
  args: ReadonlyMap<string, string>,
  flag: string,
): string {
  const value = args.get(flag);
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function requiredEnvironment(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is required; use the operator-reachable Temporal endpoint`,
    );
  }
  return value;
}
