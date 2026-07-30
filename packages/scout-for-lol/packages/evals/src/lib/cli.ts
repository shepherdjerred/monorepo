export function argumentValue(
  name: string,
  commandLineArguments: readonly string[] = Bun.argv,
): string | undefined {
  const index = commandLineArguments.indexOf(name);
  if (index === -1) return undefined;

  const value = commandLineArguments[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith("-")) {
    throw new Error(`Option ${name} requires a value`);
  }
  return value;
}

export function evalDatabasePath(): string {
  return (
    argumentValue("--database") ??
    Bun.env["SCOUT_EVAL_DATABASE_PATH"] ??
    new URL("../../data/scout-review-evals.sqlite", import.meta.url).pathname
  );
}
