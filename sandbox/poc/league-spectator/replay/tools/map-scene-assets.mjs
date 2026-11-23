import { latestMovementOrigin } from "../latest-movement.mjs";

export const MAP11_RESEARCH_BUILD = "16.21.829.8620";
export const MAP11_RELEASE_URL =
  "https://lol.secure.dyn.riotcdn.net/channels/public/releases/B499FB04B1158CF6.manifest";
export const MAP11_RELEASE_SHA256 =
  "56a8c30798d8649e05a461142636f6995c48bfaa4d9ada10fd5c70323e86a934";

// Static height extraction only; this does not admit collision, movement,
// dynamic terrain or a map-specific native world presentation policy.
export function readMapHeightGrid(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 39)
    throw Error("Truncated map navigation grid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 7 || view.getUint16(1, true) !== 1)
    throw Error("Unsupported map navigation grid");
  const min = [3, 7, 11].map((offset) => view.getFloat32(offset, true));
  const max = [15, 19, 23].map((offset) => view.getFloat32(offset, true));
  const nx = view.getUint32(31, true),
    nz = view.getUint32(35, true);
  const offset = 39 + nx * nz * 54 + 1056;
  if (
    !nx ||
    !nz ||
    offset + 16 > bytes.byteLength ||
    ![...min, ...max].every(Number.isFinite)
  )
    throw Error("Invalid map navigation bounds");
  const x = view.getUint32(offset, true),
    z = view.getUint32(offset + 4, true);
  const step = [
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true),
  ];
  if (
    x < 2 ||
    z < 2 ||
    offset + 16 + x * z * 4 > bytes.byteLength ||
    !step.every((value) => Number.isFinite(value) && value > 0)
  )
    throw Error("Invalid map height grid");
  const heights = bytes.slice(offset + 16, offset + 16 + x * z * 4);
  const values = new DataView(
    heights.buffer,
    heights.byteOffset,
    heights.byteLength,
  );
  for (let at = 0; at < heights.byteLength; at += 4)
    if (!Number.isFinite(values.getFloat32(at, true)))
      throw Error("Non-finite map height sample");
  return {
    min,
    max,
    movementOrigin: latestMovementOrigin(min, max),
    x,
    z,
    step,
    heights,
  };
}

export function mapBinHash(value) {
  let hash = 2166136261;
  for (const character of value.toLowerCase())
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

// Labels are recovered only through their exact original FNV hash. Unknown
// fields/classes remain hash-addressed; no general BIN name dictionary is needed.
export function normalizeMapBin(tree, materialNames) {
  if (
    tree.schema !== 1 ||
    tree.reader !== "scout-exact-property-bin-16.21" ||
    !Array.isArray(tree.objects) ||
    !Array.isArray(tree.dependencies)
  )
    throw Error("Original typed BIN decoder output required");
  const fields = [
    "components",
    "NavGridPath",
    "samplerValues",
    "TextureName",
    "texturePath",
    "techniques",
    "passes",
    "shader",
    "paramValues",
    "name",
    "value",
    "items",
    "Character",
    "Skin",
    "Team",
    "transform",
  ];
  const fieldNames = new Map(fields.map((name) => [mapBinHash(name), name]));
  const classNames = new Map(
    ["MapNavGrid", "MapContainer"].map((name) => [mapBinHash(name), name]),
  );
  const paths = new Map();
  for (const name of materialNames) {
    const hash = mapBinHash(name);
    if (paths.has(hash) && paths.get(hash) !== name)
      throw Error("Ambiguous original map material path hash");
    paths.set(hash, name);
  }
  const structure = (node) =>
    Object.assign(
      { __type: classNames.get(node.classHash) ?? `{${node.classHash}}` },
      Object.fromEntries(
        Object.entries(node.fields).map(([hash, property]) => [
          fieldNames.get(hash) ?? `{${hash}}`,
          value(property),
        ]),
      ),
    );
  function value(property) {
    if (["Struct", "Embedded"].includes(property.type))
      return structure(property);
    if (["Container", "UnorderedContainer"].includes(property.type))
      return property.elements.map(value);
    if (property.type === "Map")
      return property.entries.map((entry) => ({
        key: value(entry.key),
        value: value(entry.value),
      }));
    if (property.type === "Optional")
      return property.value === null ? null : value(property.value);
    if (["Hash", "ObjectLink"].includes(property.type))
      return `{${Number(property.value).toString(16).padStart(8, "0")}}`;
    if (property.type === "Hash64")
      return `{${BigInt(property.value).toString(16).padStart(16, "0")}}`;
    if (property.type === "WadChunkLink")
      return { kind: "wad-path-hash", value: property.value };
    if (["Vector2", "Vector3", "Vector4"].includes(property.type))
      return ["X", "Y", "Z", "W"]
        .slice(0, Number(property.type.at(-1)))
        .map((axis) => property.value[axis]);
    if (!Object.hasOwn(property, "value"))
      throw Error(`Unsupported original BIN property ${property.type}`);
    return property.value;
  }
  return Object.fromEntries(
    tree.objects.map((node) => [
      paths.get(node.pathHash) ?? `{${node.pathHash}}`,
      structure(node),
    ]),
  );
}
