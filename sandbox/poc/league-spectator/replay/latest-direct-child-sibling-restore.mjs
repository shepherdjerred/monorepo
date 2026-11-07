import { sha256 } from "./structural-comparison.mjs";
import {
  createLatestDirectChildSiblingPrograms,
  canonicalChildSource,
} from "./latest-direct-child-siblings.mjs";

// Re-establish owned capability programs after structured worker transfer.
// Recompile from hash-checked original definition bytes, never from assertions
// carried only in the serialized program.
export async function restoreLatestDirectChildSiblingPrograms({
  profile,
  packages,
  definitions,
  contentHash,
}) {
  const admitted = [...definitions.values()].filter(
    (d) => d.childSiblingProgram != null,
  );
  if (
    !admitted.length &&
    (packages.childSiblingDefinitions === undefined ||
      (Array.isArray(packages.childSiblingDefinitions) &&
        packages.childSiblingDefinitions.length === 0))
  )
    return;
  if (
    !(packages.effectsManifest instanceof Uint8Array) ||
    (await sha256(packages.effectsManifest)) !== contentHash ||
    !Array.isArray(packages.childSiblingDefinitions)
  )
    throw Error(
      "Original child sibling definitions and static manifest required",
    );
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packages.effectsManifest),
  );
  if (
    manifest.build !== profile.clientVersion ||
    manifest.protocol !== profile.protocolDigest
  )
    throw Error("Child sibling definition manifest build differs");
  const sources = new Map();
  for (const row of packages.childSiblingDefinitions) {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      typeof row[0] !== "string" ||
      !(row[1] instanceof Uint8Array) ||
      sources.has(row[0])
    )
      throw Error("Unique original child sibling definition bytes required");
    sources.set(row[0], row[1]);
  }
  if (sources.size !== admitted.length)
    throw Error(
      "Child sibling source inventory differs from compiled programs",
    );
  const factory = await createLatestDirectChildSiblingPrograms({
    profile,
    packageBytes: packages.childSiblings,
  });
  for (const d of admitted) {
    const bytes = sources.get(d.id);
    if (
      !bytes ||
      (await sha256(bytes)) !== d.definitionHash ||
      manifest.definitions[d.id]?.sha256 !== d.definitionHash
    )
      throw Error("Original child sibling definition hash differs");
    const record = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const expected = await factory.compile({
      id: d.id,
      definition: record.definition,
      systemIdentity: d.systemIdentity,
    });
    if (
      !expected ||
      canonicalChildSource(expected) !==
        canonicalChildSource(d.childSiblingProgram)
    )
      throw Error(
        "Serialized child sibling program differs from original definition",
      );
    definitions.set(d.id, { ...d, childSiblingProgram: expected });
  }
}
