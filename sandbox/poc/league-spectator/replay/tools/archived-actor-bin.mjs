import { mapBinHash } from "./map-scene-assets.mjs";

export const ACTOR_META_SOURCE_SHA256 =
  "7019bed2520e3749762e2cc0d53e8e7612687f5619e30a56668085d03a1ff77a";
export const ACTOR_TOOLKIT_REVISION =
  "76bf57bf4fd195343dec610bf0f912a06b910914";
const hex = (value) => Number(value).toString(16).padStart(8, "0");
const identity = (token) =>
  token.startsWith('"')
    ? { hash: mapBinHash(JSON.parse(token)), name: JSON.parse(token) }
    : { hash: hex(token.replace(/U$/i, "")), name: null };

// Names annotate exact hashes only. This does not deserialize through older
// Toolkit BIN readers or fill omitted properties from guessed/default values.
export function readActorMetaNames(source) {
  const pattern =
    /\[MetaClassAttribute\(("[^"\r\n]+"|\d+U)\)\]\s*public class (\w+)\s*:\s*(\w+)/g;
  const entries = [...source.matchAll(pattern)];
  if (!entries.length) throw Error("Pinned Toolkit metadata classes required");
  const classes = new Map(),
    byIdentifier = new Map();
  for (let index = 0; index < entries.length; index++) {
    const match = entries[index],
      type = identity(match[1]);
    if (classes.has(type.hash)) throw Error("Duplicate Toolkit class hash");
    const body = source.slice(
      match.index + match[0].length,
      entries[index + 1]?.index ?? source.length,
    );
    const fields = new Map();
    for (const property of body.matchAll(
      /\[MetaPropertyAttribute\(("[^"\r\n]+"|\d+U),/g,
    )) {
      const field = identity(property[1]);
      if (fields.has(field.hash) && fields.get(field.hash) !== field.name)
        throw Error("Ambiguous Toolkit field hash");
      fields.set(field.hash, field.name);
    }
    const entry = { ...type, identifier: match[2], parent: match[3], fields };
    classes.set(type.hash, entry);
    byIdentifier.set(entry.identifier, entry);
  }
  const fieldName = (classHash, hash) => {
    let entry = classes.get(classHash);
    const visited = new Set();
    while (entry) {
      if (visited.has(entry.identifier))
        throw Error("Cyclic Toolkit class inheritance");
      visited.add(entry.identifier);
      if (entry.fields.has(hash)) return entry.fields.get(hash) ?? `{${hash}}`;
      entry = byIdentifier.get(entry.parent);
    }
    return `{${hash}}`;
  };
  return {
    className: (hash) => classes.get(hash)?.name ?? `{${hash}}`,
    fieldName,
  };
}

export function normalizeActorBin(tree, names, knownPaths = [], normalizeMap) {
  if (
    tree.build !== "16.21.829.8620" ||
    tree.reader !== "scout-exact-property-bin-16.21"
  )
    throw Error("Exact original 16.21 typed BIN required");
  const paths = new Map();
  for (const path of knownPaths) {
    const key = mapBinHash(path);
    if (paths.has(key) && paths.get(key).toLowerCase() !== path.toLowerCase())
      throw Error("Ambiguous original actor object path");
    paths.set(key, path);
  }
  const hashValue = (number) => paths.get(hex(number)) ?? `{${hex(number)}}`;
  const structure = (node, ownerPath, trail) => ({
    __type: names.className(node.classHash),
    ...Object.fromEntries(
      Object.entries(node.fields).map(([hash, property]) => {
        try {
          return [
            names.fieldName(node.classHash, hash),
            value(property, {
              ownerPath,
              trail: [...trail, "fields", hash],
              ownerTrail: trail,
              classHash: node.classHash,
              fieldHash: hash,
            }),
          ];
        } catch (error) {
          if (!error.binField)
            error.binField = {
              classHash: node.classHash,
              className: names.className(node.classHash),
              fieldHash: hash,
              fieldName: names.fieldName(node.classHash, hash),
            };
          throw error;
        }
      }),
    ),
  });
  function value(property, context) {
    if (["Struct", "Embedded"].includes(property.type))
      return structure(property, context.ownerPath, context.trail);
    if (["Container", "UnorderedContainer"].includes(property.type))
      return property.elements.map((child, index) =>
        value(child, {
          ...context,
          trail: [...context.trail, "elements", index],
        }),
      );
    if (property.type === "Map") {
      const entries = property.entries.map((entry, index) => [
        value(entry.key, {
          ...context,
          trail: [...context.trail, "entries", index, "key"],
        }),
        value(entry.value, {
          ...context,
          trail: [...context.trail, "entries", index, "value"],
        }),
      ]);
      const complexKey = entries.some(
        ([key]) => !["string", "number", "boolean"].includes(typeof key),
      );
      if (
        complexKey ||
        new Set(entries.map(([key]) => String(key))).size !== entries.length
      ) {
        // Galio40's original AtomicClipData field f598463e repeats Hash keys
        // for distinct event structures. Preserve typed order without claiming
        // native lookup/activation semantics or overwriting an earlier entry.
        const opaque = {
          __type: "UnresolvedOriginalBinMap",
          reason: complexKey
            ? "complex-original-map-keys"
            : "duplicate-original-map-keys",
          entries: entries.map(([key, value], sourceEntry) => ({
            key,
            value,
            sourceEntry,
          })),
          original: structuredClone(property),
        };
        return (
          normalizeMap?.(opaque, {
            sourceBinSha256: tree.sourceSha256,
            ownerPath: context.ownerPath,
            trail: context.ownerTrail,
            classHash: context.classHash,
            fieldHash: context.fieldHash,
          }) ?? opaque
        );
      }
      return Object.fromEntries(entries);
    }
    if (property.type === "Optional")
      return property.value === null
        ? null
        : value(property.value, {
            ...context,
            trail: [...context.trail, "value"],
          });
    if (["Hash", "ObjectLink"].includes(property.type))
      return hashValue(property.value);
    if (property.type === "Hash64")
      return `{${BigInt(property.value).toString(16).padStart(16, "0")}}`;
    if (property.type === "WadChunkLink")
      return { kind: "wad-path-hash", value: property.value };
    if (["Vector2", "Vector3", "Vector4"].includes(property.type))
      return ["X", "Y", "Z", "W"]
        .slice(0, Number(property.type.at(-1)))
        .map((axis) => property.value[axis]);
    if (property.type === "Matrix44")
      return Array.from({ length: 4 }, (_, index) =>
        property.value.slice(index * 4, index * 4 + 4),
      );
    if (!Object.hasOwn(property, "value"))
      throw Error(`Unsupported original BIN property ${property.type}`);
    return property.value;
  }
  return Object.fromEntries(
    tree.objects.map((node) => [
      paths.get(node.pathHash) ?? `{${node.pathHash}}`,
      structure(node, node.pathHash, []),
    ]),
  );
}

export function actorUnsupportedDeclarations(normalized) {
  const result = [];
  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    if (value.__type === "UnresolvedOriginalBinMap") {
      result.push({
        path,
        reason: value.reason,
        entries: value.original.entries.length,
      });
      return;
    }
    for (const [key, child] of Object.entries(value))
      visit(child, [...path, key]);
  }
  visit(normalized, []);
  return result;
}

export function actorObjectHash(reference) {
  if (typeof reference !== "string" || !reference.length)
    throw Error("Exact actor object reference required");
  return /^\{[a-f\d]{8}\}$/i.test(reference)
    ? reference.slice(1, -1).toLowerCase()
    : mapBinHash(reference);
}

export function findActorObject(tree, reference) {
  const expected = actorObjectHash(reference);
  const entries = Object.entries(tree).filter(
    ([path]) => actorObjectHash(path) === expected,
  );
  if (entries.length !== 1)
    throw Error(`Unique archived actor object required: ${reference}`);
  return entries[0][1];
}

export function validateActorRequest(request) {
  if (
    request?.schema !== 1 ||
    request.build !== "16.21.829.8620" ||
    request.protocol !== "20e09df23c66b85e" ||
    !Array.isArray(request.actors) ||
    !request.actors.length ||
    request.actors.length > 2048
  )
    throw Error("Exact 16.21 static actor request required");
  const actors = new Map();
  for (const actor of request.actors) {
    if (
      !actor ||
      !/^[a-z\d_]+$/i.test(actor.character) ||
      !Number.isSafeInteger(actor.skinId) ||
      actor.skinId < 0 ||
      actor.skinId > 10000 ||
      !["champion", "world"].includes(actor.role) ||
      !Array.isArray(actor.characterRecords) ||
      actor.characterRecords.some(
        (path) => typeof path !== "string" || !path.length,
      )
    )
      throw Error("Invalid archived actor request");
    const key = `${actor.character.toLowerCase()}/${actor.skinId}`;
    if (actors.has(key)) throw Error("Duplicate archived actor request");
    actors.set(key, { ...actor, key });
  }
  return [...actors.values()];
}
