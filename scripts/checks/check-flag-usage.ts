/**
 * Freshness check for the committed flag-usage index.
 *
 * Regenerates `packages/flags/src/flag-usage.generated.json` in memory with
 * the same code `generate-flag-usage` runs and fails when the committed file
 * differs, naming the keys whose read sites changed and the exact command
 * that refreshes it. Scope validation (every inventory namespace has a
 * `flag-usage-scopes.json` entry) runs as part of the regeneration.
 */

import path from "node:path";

import {
  collectFlagUsageIndex,
  type FlagUsageEntry,
  type FlagUsageIndex,
  FlagUsageIndexSchema,
  OUTPUT_PATH,
  REGENERATE_COMMAND,
  renderFlagUsageIndex,
  REPOSITORY_ROOT,
} from "../generate/flag-usage.ts";

const MAX_REPORTED_LINES = 40;

function describeEntry(entry: FlagUsageEntry): string {
  return `${entry.file} (${entry.kind} x${entry.count.toString()})`;
}

function setDifference(
  label: string,
  before: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  after: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): string[] {
  return [
    ...[...after.keys()]
      .filter((id) => !before.has(id))
      .map((id) => `+ ${label}${id}`),
    ...[...before.keys()]
      .filter((id) => !after.has(id))
      .map((id) => `- ${label}${id}`),
  ];
}

/** Human-readable differences between the committed and expected index. */
export function describeFlagUsageDrift(
  committed: FlagUsageIndex,
  expected: FlagUsageIndex,
): string[] {
  const lines: string[] = [];
  const keys = [
    ...new Set([
      ...Object.keys(committed.flags),
      ...Object.keys(expected.flags),
    ]),
  ].toSorted();
  for (const key of keys) {
    const before = new Map(
      (committed.flags[key] ?? []).map((entry) => [
        describeEntry(entry),
        entry,
      ]),
    );
    const after = new Map(
      (expected.flags[key] ?? []).map((entry) => [describeEntry(entry), entry]),
    );
    lines.push(...setDifference(`${key}: `, before, after));
  }
  lines.push(
    ...setDifference(
      "unreferenced: ",
      new Set(committed.unreferenced),
      new Set(expected.unreferenced),
    ),
  );
  return lines;
}

async function readCommitted(): Promise<
  { text: string; index: FlagUsageIndex | undefined } | undefined
> {
  const file = Bun.file(path.join(REPOSITORY_ROOT, OUTPUT_PATH));
  if (!(await file.exists())) return undefined;
  const text = await file.text();
  try {
    const parsed = FlagUsageIndexSchema.safeParse(JSON.parse(text));
    return { text, index: parsed.success ? parsed.data : undefined };
  } catch {
    return { text, index: undefined };
  }
}

export async function checkFlagUsage(): Promise<void> {
  const expected = await collectFlagUsageIndex();
  const expectedText = await renderFlagUsageIndex(expected);
  const committed = await readCommitted();
  if (committed?.text === expectedText) {
    console.log(
      `${OUTPUT_PATH} is fresh: ${Object.keys(expected.flags).length.toString()} referenced, ${expected.unreferenced.length.toString()} unreferenced`,
    );
    return;
  }

  let details: string[];
  if (committed === undefined) {
    details = [`${OUTPUT_PATH} does not exist`];
  } else if (committed.index === undefined) {
    details = [`${OUTPUT_PATH} is not a valid version-1 flag-usage index`];
  } else {
    details = describeFlagUsageDrift(committed.index, expected);
    if (details.length === 0) {
      details = ["contents match but formatting differs"];
    }
  }
  const shown = details.slice(0, MAX_REPORTED_LINES);
  const hidden = details.length - shown.length;
  console.error(`ERROR: ${OUTPUT_PATH} is stale.`);
  for (const line of shown) console.error(`  ${line}`);
  if (hidden > 0) console.error(`  … and ${hidden.toString()} more`);
  throw new Error(
    `${OUTPUT_PATH} does not match the code. Regenerate it with: ${REGENERATE_COMMAND}`,
  );
}

if (import.meta.main) {
  await checkFlagUsage();
}
