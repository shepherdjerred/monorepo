import { shellQuote } from "#src/pipeline/emit.ts";

/** Workflows whose task diagnostics `scripts/ci/run-with-diagnostics.ts` retains. */
export type DiagnosticWorkflow =
  "verify" | "playwright-e2e" | "verify-extended";

/** Toolchain bootstrap must run before Bun's shim can load the wrapper. */
export function diagnosticCommands(
  workflow: DiagnosticWorkflow,
  commands: readonly string[],
): string[] {
  const [bootstrap, ...body] = commands;
  if (bootstrap === undefined)
    throw new Error("Diagnostic workflow requires toolchain bootstrap");
  return [
    bootstrap,
    `bun --no-install scripts/ci/run-with-diagnostics.ts ${workflow} -- bash -euo pipefail -c ${shellQuote(body.join("\n"))}`,
  ];
}
