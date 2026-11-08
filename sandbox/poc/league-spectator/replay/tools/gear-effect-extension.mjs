import { stringifyAssetJson } from "./asset-json.mjs";

export function gearMetaHash(value) {
  if (typeof value !== "string")
    throw Error("Static reference must be a string");
  if (/^\{[a-f0-9]{8}\}$/i.test(value)) return value.slice(1, -1).toLowerCase();
  let hash = 2166136261;
  for (const char of value.toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function gearAssetPath(path) {
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.includes(":") ||
    path.split(/[\\/]/).some((part) => part === ".." || part === "." || !part)
  )
    throw Error(`Invalid installed asset path ${path}`);
  return path.replaceAll("\\", "/").toLowerCase();
}

// A selected top resolver is known. An older stack is not reconstructed here.
// Literal object references and first matching gear rows can be prepared;
// resource keys absent from that top resolver remain explicit omissions.
export function buildGearEffectClosure({
  actorKey,
  gear,
  resourceKeys,
  objects,
  baseResources,
}) {
  if (
    !/^(champions|world)\/[a-z0-9_]+\/\d+$/.test(actorKey) ||
    !Array.isArray(resourceKeys) ||
    !resourceKeys.length ||
    resourceKeys.length > 256 ||
    resourceKeys.some(
      (key) => !Number.isInteger(key) || key <= 0 || key > 0xffffffff,
    ) ||
    new Set(resourceKeys).size !== resourceKeys.length
  )
    throw Error("Bounded unique nonzero gear resource keys required");
  const aliases = new Map(),
    rows = [],
    definitions = new Map(),
    queue = [],
    unresolved = [];
  for (const row of gear.rows) {
    if (
      !Number.isInteger(row.key) ||
      row.key < 0 ||
      row.key > 0xffffffff ||
      !Number.isInteger(row.value) ||
      row.value < 0 ||
      row.value > 0xffffffff
    )
      throw Error("Invalid original gear row");
    const key = row.key.toString(16).padStart(8, "0");
    if (!aliases.has(key))
      aliases.set(key, row.value.toString(16).padStart(8, "0"));
  }
  const resolve = (id) => {
    const object = objects.get(id);
    if (!object)
      throw Error(`Referenced gear definition absent: ${actorKey}/${id}`);
    return object;
  };
  for (const key of resourceKeys) {
    const token = aliases.get(key.toString(16).padStart(8, "0"));
    if (token === undefined)
      throw Error("Selected key absent from known top gear resolver");
    if (token === "00000000") {
      rows.push({
        key,
        referenceToken: 0,
        status: "null-object-link",
        definitionId: null,
      });
      continue;
    }
    const object = resolve(token);
    if (
      gearMetaHash(object.value.__type) !==
      gearMetaHash("VfxSystemDefinitionData")
    )
      throw Error("Selected gear resource is not an effect definition");
    rows.push({
      key,
      referenceToken: parseInt(token, 16),
      status: "prepared-definition",
      definitionId: `${actorKey}/${token}`,
    });
    queue.push(token);
  }
  while (queue.length) {
    const id = queue.shift();
    if (definitions.has(id)) continue;
    if (definitions.size >= 8192)
      throw Error("Gear definition closure exceeded bound");
    const object = resolve(id),
      dependencies = [],
      references = [];
    function walk(value, property) {
      if (Array.isArray(value))
        return value.forEach((item, i) => walk(item, `${property}[${i}]`));
      if (value && typeof value === "object") {
        for (const [name, item] of Object.entries(value))
          if (
            ![
              "__type",
              "objectPath",
              "particleName",
              "particlePath",
              "emitterName",
            ].includes(name)
          )
            walk(item, `${property}.${name}`);
        return;
      }
      if (typeof value !== "string") return;
      if (/^(assets|data)\/.+\.[a-z0-9_]+$/i.test(value)) {
        dependencies.push({ property, path: gearAssetPath(value) });
        return;
      }
      const key = gearMetaHash(value),
        alias = aliases.get(key);
      if (alias === "00000000") {
        references.push({
          property,
          resourceKey: key,
          status: "null-object-link",
        });
        return;
      }
      if (alias === undefined && Object.hasOwn(baseResources, key)) {
        const omission = {
          definitionId: `${actorKey}/${id}`,
          property,
          resourceKey: key,
          reason: "form:older-stack-unrecovered-for-absent-top-gear-key",
        };
        unresolved.push(omission);
        references.push({
          property,
          resourceKey: key,
          status: "unresolved",
          reason: omission.reason,
        });
        return;
      }
      const target = alias ?? (objects.has(key) ? key : null);
      if (target === null) return;
      resolve(target);
      references.push({
        property,
        effectId: `${actorKey}/${target}`,
        status: "reference; activation semantics unresolved",
      });
      queue.push(target);
    }
    walk(object.value, "");
    definitions.set(id, {
      id,
      actor: actorKey,
      sourceBins: [...object.sources],
      definition: object.value,
      dependencies,
      references,
    });
  }
  return { rows, definitions, unresolved };
}

// A single ID cannot conceal context-dependent child-resource resolution.
export function mergeGearDefinitions(target, closure) {
  for (const [id, definition] of closure.definitions) {
    const key = `${definition.actor}/${id}`,
      previous = target.get(key);
    if (
      previous &&
      stringifyAssetJson(previous) !== stringifyAssetJson(definition)
    )
      throw Error(`Gear-context definition collision: ${key}`);
    target.set(key, definition);
  }
}
