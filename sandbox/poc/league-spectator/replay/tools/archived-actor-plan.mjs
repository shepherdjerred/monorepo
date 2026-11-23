import { actorObjectHash, findActorObject } from "./archived-actor-bin.mjs";

export function actorReferenceKey(reference) {
  if (typeof reference === "string" && reference.length)
    return reference.toLowerCase();
  if (reference?.kind === "wad-path-hash" && /^\d+$/.test(reference.value))
    return `wad-hash:${BigInt(reference.value)}`;
  throw Error("Original actor asset reference required");
}

export function selectActorSkin(normalized, actor) {
  const path = `Characters/${actor.character}/Skins/Skin${actor.skinId}`;
  const skin = findActorObject(normalized, path);
  if (skin.__type !== "SkinCharacterDataProperties" || !skin.skinMeshProperties)
    throw Error(`Unsupported archived skin definition: ${actor.key}`);
  const mesh = skin.skinMeshProperties;
  if (!mesh.simpleSkin || !mesh.skeleton)
    throw Error(`Archived skin has no original mesh/rig: ${actor.key}`);
  actorReferenceKey(mesh.simpleSkin);
  actorReferenceKey(mesh.skeleton);
  if (
    mesh.skinScale !== undefined &&
    (!Number.isFinite(mesh.skinScale) || mesh.skinScale <= 0)
  )
    throw Error("Invalid original skin scale");
  if (
    mesh.initialSubmeshToHide !== undefined &&
    typeof mesh.initialSubmeshToHide !== "string"
  )
    throw Error("Invalid original initial submesh visibility");
  return {
    skin,
    mesh,
    objectPath: path,
    hidden: (mesh.initialSubmeshToHide ?? "").split(/[,\s]+/).filter(Boolean),
  };
}

export function selectActorTexture({ skin, mesh, range, objects }) {
  const overrides = (mesh.materialOverride ?? []).filter(
    (entry) => entry.submesh?.toLowerCase() === range.toLowerCase(),
  );
  if (overrides.length > 1)
    throw Error("Ambiguous original submesh material override");
  const override = overrides[0];
  if (override?.texture)
    return { reference: override.texture, source: "original-submesh-texture" };
  const materialReference = override?.Material ?? mesh.Material;
  if (materialReference) {
    const matches = objects.filter(
      ([path]) => actorObjectHash(path) === actorObjectHash(materialReference),
    );
    if (matches.length !== 1)
      throw Error("Unresolved original actor material reference");
    const material = matches[0][1];
    // Sampler names declare separate shader inputs. Accept only an unambiguous
    // authored albedo candidate; never substitute another material's texture.
    const main = (material.samplerValues ?? []).filter((entry) =>
      /^Main_?Texture$/i.test(entry.TextureName),
    );
    const diffuse = (material.samplerValues ?? []).filter((entry) =>
      /^Diffuse_?Texture$/i.test(entry.TextureName),
    );
    const selected =
      main.length === 1
        ? main
        : main.length === 0 && diffuse.length === 1
          ? diffuse
          : [];
    if (selected.length !== 1 || !selected[0].texturePath)
      throw Error("Unsupported original material albedo sampler");
    return {
      reference: selected[0].texturePath,
      source: "original-material-sampler",
      material: materialReference,
      approximation:
        "Authored albedo only; native shader/compositing remains unimplemented",
    };
  }
  if (!mesh.texture) throw Error("Original actor texture is absent");
  return { reference: mesh.texture, source: "original-skin-texture" };
}

export function selectActorAnimations(graph, nativeClipDeclaration) {
  const definitions = Object.values(graph).filter(
    (entry) => entry.__type === "AnimationGraphData",
  );
  if (definitions.length !== 1)
    throw Error("Unique original actor animation graph required");
  const clips = definitions[0].mClipDataMap;
  if (!clips || Array.isArray(clips))
    throw Error("Original actor animation clip map required");
  const unresolvedLookup = clips.__type === "UnresolvedOriginalBinMap";
  if (unresolvedLookup && clips.reason !== "duplicate-original-map-keys")
    throw Error("Unsupported original clip-map key type");
  const declared = unresolvedLookup
    ? clips.entries.map((entry) => ({
        name: `${entry.key}@entry-${entry.sourceEntry}`,
        originalKey: entry.key,
        sourceEntry: entry.sourceEntry,
        clip: entry.value,
      }))
    : Object.entries(clips).map(([name, clip]) => ({
        name,
        originalKey: name,
        sourceEntry: null,
        clip,
      }));
  const selected = {},
    files = new Map(),
    original = {},
    clipSources = {};
  for (const { name, originalKey, sourceEntry, clip } of declared) {
    if (clip.__type !== "AtomicClipData") continue;
    const reference = clip.mAnimationResourceData?.mAnimationFilePath;
    let key;
    try {
      key = actorReferenceKey(reference);
    } catch {
      throw Error(`Atomic clip has no original animation file: ${name}`);
    }
    if (!files.has(key))
      files.set(key, { reference, file: `animations/${files.size}.anm` });
    selected[name] = files.get(key).file;
    original[name] = reference;
    clipSources[name] = { originalKey, sourceEntry, reference };
  }
  if (!Object.keys(selected).length)
    throw Error(
      "Original actor graph has no supported atomic animation resources",
    );
  const preview = (pattern) =>
    Object.keys(original).find(
      (name) =>
        typeof original[name] === "string" && pattern.test(original[name]),
    );
  return {
    selected,
    files: [...files.values()],
    clipSources,
    lookupStatus: unresolvedLookup
      ? "unsupported-original-duplicate-key-semantics"
      : nativeClipDeclaration
        ? "proved-original-native-clip-cache"
        : "unique-original-clip-keys",
    previewClips: {
      idle: unresolvedLookup
        ? null
        : (preview(/(?:^|[_/])idle1?\.anm$/i) ?? null),
      run: unresolvedLookup
        ? null
        : (preview(/(?:^|[_/])run1?\.anm$/i) ?? null),
      status:
        "Heuristic original-file preview only; native graph/controller evaluation unresolved",
    },
  };
}
