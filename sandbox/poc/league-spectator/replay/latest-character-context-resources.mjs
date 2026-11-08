// Original character-context resource names. These describe static lookup
// inputs; constructing them never establishes registry publication or readiness.
import { nativeCharacterEffectContextIdentity } from "./latest-effect-contexts.mjs";

function text(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_/-]{1,1024}$/.test(value))
    throw Error("Bounded explicit ASCII character/namespace required");
  return value;
}

export function compileCharacterContextResourceNames(name, skinId, namespace) {
  text(name);
  text(namespace);
  if (!Number.isInteger(skinId) || skinId < 0 || skinId > 0xffffffff)
    throw Error("Unsigned character skin required");
  const resourceName = `${namespace}/${name}/Skins/Skin${skinId}/Resources`;
  let resourceIdentity = 0x811c9dc5;
  for (const char of resourceName) {
    const c = char.charCodeAt(0);
    resourceIdentity =
      Math.imul(
        resourceIdentity ^ (c >= 65 && c <= 90 ? c + 32 : c),
        0x1000193,
      ) >>> 0;
  }
  return Object.freeze({
    name,
    skinId,
    namespace,
    contextIdentity: nativeCharacterEffectContextIdentity(
      name,
      skinId,
      namespace,
    ),
    fileCandidates:
      skinId === 0
        ? Object.freeze([
            `DATA/${namespace}/${name}/Skins/Skin0.bin`,
            `DATA/${namespace}/${name}/${name}.bin`,
          ])
        : null,
    nonzeroSkinLoaderTranslated: false,
    resourceName,
    resourceIdentity,
    originalIdentityRange: Object.freeze([0x351af4, 0x351b46]),
    originalSkinZeroLoadRange: Object.freeze([0x35258a, 0x352767]),
    registryPublicationEstablished: false,
    linkedResourceAssets: false,
  });
}

// Original352741..352767 assigns the exact typed result, including null, to
// context+60 and marks the load attempt. Publication is a separate later step.
export function bindSuppliedCharacterContextResource(names, result) {
  const expected = compileCharacterContextResourceNames(
    names?.name,
    names?.skinId,
    names?.namespace,
  );
  if (
    names.contextIdentity !== expected.contextIdentity ||
    names.resourceIdentity !== expected.resourceIdentity
  )
    throw Error("Matching compiled character context names required");
  if (
    !result ||
    result.status !== "supplied-original-typed-resource-query" ||
    result.resourceIdentity !== expected.resourceIdentity ||
    typeof result.found !== "boolean" ||
    (result.found
      ? !Number.isInteger(result.typeHash) ||
        result.typeHash < 0 ||
        result.typeHash > 0xffffffff
      : result.typeHash !== null) ||
    !Array.isArray(result.rows) ||
    result.rows.length > 65536
  )
    throw Error("Explicit typed resource query result required");
  let previous = -1;
  if (result.found && ![0xef3a0f33, 0x23ea1915].includes(result.typeHash))
    throw Error("Additional original resource type conversion is untranslated");
  for (const row of result.rows) {
    if (
      !row ||
      !Number.isInteger(row.key) ||
      row.key < 0 ||
      row.key > 0xffffffff ||
      row.key <= previous ||
      !Number.isInteger(row.referenceToken) ||
      row.referenceToken < 0 ||
      row.referenceToken > 0xffffffff
    )
      throw Error("Sorted unique unsigned resource rows required");
    previous = row.key;
  }
  const accepted = result.found && result.typeHash === 0xef3a0f33;
  if (!accepted && result.rows.length)
    throw Error("Rejected or absent typed resource cannot expose rows");
  return Object.freeze({
    status: accepted
      ? "supplied-character-context-resolver"
      : "supplied-character-context-null-resolver",
    contextIdentity: expected.contextIdentity,
    resourceIdentity: expected.resourceIdentity,
    rows: Object.freeze(result.rows.map((row) => Object.freeze({ ...row }))),
    loadAttemptCompleted: true,
    originalResourceBindingRange: Object.freeze([0x352741, 0x352767]),
    originalGetterRva: 0x353f70,
    registryPublicationEstablished: false,
    linkedResourceAssets: false,
  });
}
