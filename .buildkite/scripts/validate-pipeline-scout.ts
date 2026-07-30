import {
  assertPackageTokens,
  fail,
  hasTrimmedLine,
  requireIncludes,
} from "./validate-pipeline-lib.ts";

const CLASSIC_VISUAL_INSTALL =
  "bun install --frozen-lockfile --filter '@scout-for-lol/report' --production";

export async function validateScoutPipelineContracts(
  stepBlocks: ReadonlyMap<string, string>,
): Promise<void> {
  const classicVisuals = stepBlocks.get("scout-classic-visuals");
  if (!hasTrimmedLine(classicVisuals, CLASSIC_VISUAL_INSTALL)) {
    fail(
      `Scout Classic visual lane is missing exact filtered install ${CLASSIC_VISUAL_INSTALL}`,
    );
  }

  for (const required of [
    '- "packages/glitter-context/**"',
    '- "packages/llm-models/**"',
    "bun --no-install run --cwd packages/glitter-context build:runtime",
    "bun --no-install run --cwd packages/llm-models build:runtime",
  ]) {
    requireIncludes(
      classicVisuals,
      required,
      `Scout Classic visual lane is missing runtime dependency contract ${required}`,
    );
  }

  await assertPackageTokens([
    [
      "packages/glitter-context/package.json",
      ['"build:runtime": "bun --no-install run scripts/generate.ts'],
    ],
    [
      "packages/llm-models/package.json",
      ['"build:runtime": "bun --no-install build src/index.ts'],
    ],
  ]);
}
