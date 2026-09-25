import { requireIncludes } from "./validate-pipeline-lib.ts";

// Each main refresh step builds a content-addressed candidate and promotes it
// through the pin script, serialized so two pin PRs never race.
const REFRESH_CONTRACTS = [
  ["ci-base-refresh", "ci-base", "ci-base", "ci-base-candidate.json"],
  [
    "ci-playwright-refresh",
    "ci-playwright",
    "ci-playwright",
    "ci-playwright-candidate.json",
  ],
  [
    "windows-cross-compiler-refresh",
    "windows-cross-compiler",
    "windows-cross-compiler",
    "windows-cross-compiler-candidate.json",
  ],
  [
    "windows-cross-compiler-refresh",
    "windows-cross-compiler",
    "windows-cross-compiler-winui",
    "windows-cross-compiler-winui-candidate.json",
  ],
] as const satisfies readonly (readonly [string, string, string, string])[];

export function validateCiImageRefreshContracts(
  stepBlocks: ReadonlyMap<string, string>,
): void {
  for (const [key, lane, image, candidate] of REFRESH_CONTRACTS) {
    const block = stepBlocks.get(key);
    for (const required of [
      `ci-changed.ts ${lane}`,
      `build-ci-image.ts --image ${image} --candidate-out ${candidate}`,
      `update-ci-image-pin.ts --candidate ${candidate}`,
      "concurrency: 1",
    ]) {
      requireIncludes(
        block,
        required,
        `${key} is missing content-addressed promotion contract ${required}`,
      );
    }
  }
}
