import { stringifyAssetJson } from "./asset-json.mjs";

// Rebuild prepared definitions from the already hash-verified BIN parser output.
// This migration permits only zero-sign differences. Other changes require a
// complete source preparation, rather than a numeric correction or fallback.
export function restoreEffectJsonSource(prepared, sources) {
  if (
    !/^[0-9a-f]{8}$/.test(prepared?.id) ||
    !Array.isArray(prepared.sourceBins) ||
    !prepared.sourceBins.length ||
    new Set(prepared.sourceBins).size !== prepared.sourceBins.length ||
    !Array.isArray(sources) ||
    sources.length !== prepared.sourceBins.length
  )
    throw Error("Exact prepared effect source inventory required");
  const candidates = [];
  for (const path of prepared.sourceBins) {
    const matches = sources.filter((source) => source.path === path);
    if (
      matches.length !== 1 ||
      !Object.hasOwn(matches[0].data, `{${prepared.id}}`)
    )
      throw Error(`Original effect definition missing from source: ${path}`);
    candidates.push(matches[0].data[`{${prepared.id}}`]);
  }
  if (new Set(candidates.map((value) => stringifyAssetJson(value))).size !== 1)
    throw Error("Original effect sources disagree, including signed-zero bits");
  const restored = [],
    counts = { numbers: 0 };
  function compare(previous, original, path) {
    if (typeof original === "number") {
      counts.numbers++;
      if (
        !Number.isFinite(original) ||
        typeof previous !== "number" ||
        !Number.isFinite(previous)
      )
        throw Error(`Non-finite or differently typed effect field: ${path}`);
      if (!Object.is(previous, original)) {
        if (previous !== 0 || original !== 0)
          throw Error(`Effect field differs beyond zero sign: ${path}`);
        restored.push({ path, originalNegative: Object.is(original, -0) });
      }
      return;
    }
    if (original === null || typeof original !== "object") {
      if (previous !== original) throw Error(`Effect field differs: ${path}`);
      return;
    }
    if (
      previous === null ||
      typeof previous !== "object" ||
      Array.isArray(previous) !== Array.isArray(original) ||
      stringifyAssetJson(Object.keys(previous)) !==
        stringifyAssetJson(Object.keys(original))
    )
      throw Error(`Effect structure differs: ${path}`);
    for (const key of Object.keys(original))
      compare(previous[key], original[key], `${path}/${key}`);
  }
  compare(prepared.definition, candidates[0], "");
  return { definition: structuredClone(candidates[0]), restored, counts };
}
