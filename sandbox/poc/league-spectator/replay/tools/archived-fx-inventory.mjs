import { mapBinHash } from "./map-scene-assets.mjs";

const VFX_CLASS = mapBinHash("VfxSystemDefinitionData");
const hex = (value) => Number(value).toString(16).padStart(8, "0");

export function originalFxPath(value) {
  // Actual archived Multi_Skins dependency names exceed 1,024 characters.
  // They are WAD namespace strings, never host filesystem output paths.
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !/^[\w./-]+$/.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw Error("Bounded original FX namespace path required");
  return value.toLowerCase();
}

// Inventory serialized references, including opaque maps. A display dictionary
// is never used to decide whether an original dependency exists.
export function originalFxReferences(node) {
  const references = [];
  function visit(property, trail) {
    if (["Struct", "Embedded"].includes(property.type)) {
      for (const [field, value] of Object.entries(property.fields))
        visit(value, [...trail, "fields", field]);
    } else if (["Container", "UnorderedContainer"].includes(property.type)) {
      property.elements.forEach((value, index) =>
        visit(value, [...trail, "elements", index]),
      );
    } else if (property.type === "Map") {
      property.entries.forEach((entry, index) => {
        visit(entry.key, [...trail, "entries", index, "key"]);
        visit(entry.value, [...trail, "entries", index, "value"]);
      });
    } else if (property.type === "Optional") {
      if (property.value !== null) visit(property.value, [...trail, "value"]);
    } else if (property.type === "ObjectLink" || property.type === "Hash") {
      references.push({
        type: property.type,
        value: hex(property.value),
        trail,
      });
    } else if (property.type === "WadChunkLink") {
      if (!/^\d+$/.test(String(property.value)))
        throw Error("Exact unsigned WAD reference required");
      const value = BigInt(property.value);
      if (value < 0n || value > 0xffffffffffffffffn)
        throw Error("WAD reference exceeds original width");
      references.push({ type: "WadChunkLink", value: value.toString(), trail });
    } else if (
      property.type === "String" &&
      typeof property.value === "string" &&
      /^(assets|data)\/.+\.[a-z\d_]+$/i.test(
        property.value.replaceAll("\\", "/"),
      )
    ) {
      const value = property.value.replaceAll("\\", "/").toLowerCase();
      if (
        value.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw Error("Original FX asset path contains traversal");
      references.push({ type: "String", value, trail });
    }
  }
  visit({ type: "Struct", fields: node.fields }, []);
  return references;
}

export function compileOriginalFxInventory(bins) {
  const objects = [],
    effects = [],
    classes = {},
    byHash = new Map();
  for (const bin of bins) {
    if (
      bin.tree.build !== "16.21.829.8620" ||
      bin.tree.reader !== "scout-exact-property-bin-16.21"
    )
      throw Error("Exact archived 16.21 FX BIN required");
    for (const node of bin.tree.objects) {
      const identity = {
          pathHash: node.pathHash,
          classHash: node.classHash,
          file: bin.file,
          wad: bin.wad,
          sourceSha256: bin.tree.sourceSha256,
        },
        original = { ...identity, references: originalFxReferences(node) };
      objects.push(original);
      const candidates = byHash.get(node.pathHash) ?? [];
      candidates.push({ ...identity, serialized: JSON.stringify(node) });
      byHash.set(node.pathHash, candidates);
      classes[node.classHash] = (classes[node.classHash] ?? 0) + 1;
      if (node.classHash === VFX_CLASS) effects.push(original);
    }
  }
  // Retain all candidates when archives disagree. Source presence does not
  // establish native override precedence and no candidate is silently selected.
  const conflicts = [...byHash]
    .filter(
      ([, candidates]) =>
        new Set(candidates.map((entry) => entry.serialized)).size > 1,
    )
    .map(([pathHash, candidates]) => ({
      pathHash,
      candidates: candidates.map(({ serialized: _, ...identity }) => identity),
      status: "unsupported-original-object-precedence",
    }));
  return { objects, effects, classes, conflicts };
}
