import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function runPromtoolFixture(
  fixture: Readonly<Record<string, unknown>>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "temporal-promql-"));
  try {
    const filename = path.join(directory, "cases.json");
    await Bun.write(filename, JSON.stringify(fixture));
    const result = await $`promtool test rules ${filename}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `promtool fixture failed:\n${result.stdout.toString()}${result.stderr.toString()}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The PromQL text of the named alert, so a test evaluates what ships. */
export function alertExpression(
  rules: readonly {
    readonly alert?: string | undefined;
    readonly expr: { readonly value: unknown };
  }[],
  name: string,
): string {
  const value = rules.find((rule) => rule.alert === name)?.expr.value;
  if (typeof value !== "string") {
    throw new TypeError(`Missing ${name} alert expression`);
  }
  return value;
}
