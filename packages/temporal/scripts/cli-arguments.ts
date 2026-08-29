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

export function optionalArgument(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : requiredArgument(args, flag);
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
