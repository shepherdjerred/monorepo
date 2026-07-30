export function argumentValue(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? undefined : Bun.argv[index + 1];
}

export function evalDatabasePath(): string {
  return (
    argumentValue("--database") ??
    Bun.env["SCOUT_EVAL_DATABASE_PATH"] ??
    new URL("../../data/scout-review-evals.sqlite", import.meta.url).pathname
  );
}
