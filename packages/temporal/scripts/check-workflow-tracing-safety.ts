const FORBIDDEN_HANDLER_PATTERN = /\bdefine(?:Query|Update)\b/u;
const NONDETERMINISTIC_UUID_PATTERN = /\b(?:crypto\.)?randomUUID\s*\(/u;

export type TracingSafetyViolation = {
  readonly file: string;
  readonly rule: "query-update-handler" | "nondeterministic-uuid";
};

export async function findTracingSafetyViolations(
  roots: readonly string[],
): Promise<TracingSafetyViolation[]> {
  const violations: TracingSafetyViolation[] = [];
  for (const root of roots) {
    const glob = new Bun.Glob("**/*.ts");
    for await (const relativePath of glob.scan({
      cwd: root,
      onlyFiles: true,
    })) {
      // *.test.ts and *-test-support.ts (e.g. scanner-workflow-test-support.ts,
      // test-support.ts) never ship in the workflow bundle — they exist to spin
      // up @temporalio/testing environments from the vitest process — so they
      // are exempt from workflow-replay determinism rules.
      if (
        relativePath.endsWith(".test.ts") ||
        relativePath.includes("test-support.ts")
      ) {
        continue;
      }
      const file = `${root}/${relativePath}`;
      const source = await Bun.file(file).text();
      if (FORBIDDEN_HANDLER_PATTERN.test(source)) {
        violations.push({ file, rule: "query-update-handler" });
      }
      if (NONDETERMINISTIC_UUID_PATTERN.test(source)) {
        violations.push({ file, rule: "nondeterministic-uuid" });
      }
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const packageRoot = new URL("..", import.meta.url).pathname;
  const repositoryRoot = new URL("../../..", import.meta.url).pathname;
  const roots = [
    `${packageRoot}src/workflows`,
    `${repositoryRoot}packages/scout-for-lol/packages/temporal/src/workflows`,
  ];
  const violations = await findTracingSafetyViolations(roots);
  if (violations.length === 0) return;
  const details = violations
    .map((violation) => `${violation.rule}: ${violation.file}`)
    .join("\n");
  throw new Error(
    "Temporal call-graph tracing is incompatible with Query/Update handlers and workflow code must use @temporalio/workflow uuid4() for replay safety:\n" +
      details,
  );
}

if (import.meta.main) {
  await main();
}
