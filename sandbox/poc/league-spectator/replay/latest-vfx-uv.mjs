// Exact-build link flags. This classifies required CPU records; it does not
// sample curves, advance UVs, acquire textures or establish shader behavior.
export function createLatestVfxUv(definition) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.predicateRva !== 0x16e1d6d ||
    definition.predicateEndRva !== 0x16e1dbe ||
    definition.linkFlagOffsets?.join(",") !== "232,233"
  )
    throw Error("Unsupported VFX UV package");
  const fields = {
    base: [
      ["birthUVOffset", 2, "ValueVector2", 0],
      ["birthUvScrollRate", 2, "ValueVector2", 0],
      ["birthUvRotateRate", 1, "ValueFloat", 0],
      ["uvRotation", 1, "ValueFloat", 0],
      ["particleUVScrollRate", 2, "IntegratedValueVector2", 0],
      ["particleUVRotateRate", 1, "IntegratedValueFloat", 0],
      ["uvScale", 2, "ValueVector2", 1],
    ],
    mult: [
      ["birthUVOffsetMult", 2, "ValueVector2", 0],
      ["birthUvScrollRateMult", 2, "ValueVector2", 0],
      ["birthUvRotateRateMult", 1, "ValueFloat", 0],
      ["UvRotationMult", 1, "ValueFloat", 0],
      ["ParticleIntegratedUvScrollMult", 2, "IntegratedValueVector2", 0],
      ["ParticleIntegratedUvRotateMult", 1, "IntegratedValueFloat", 0],
      ["uvScaleMult", 2, "ValueVector2", 1],
    ],
  };
  function object(value, type) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.__type !== type
    )
      throw Error(`Invalid UV value type: ${type}`);
    return value;
  }
  function changed(value, width, type, defaultValue) {
    object(value, type);
    const constant = Object.hasOwn(value, "constantValue")
      ? value.constantValue
      : width === 1
        ? defaultValue
        : Array(width).fill(defaultValue);
    const lanes = width === 1 ? [constant] : constant;
    if (
      !Array.isArray(lanes) ||
      lanes.length !== width ||
      lanes.some(
        (n) => typeof n !== "number" || !Number.isFinite(Math.fround(n)),
      )
    )
      throw Error("Invalid UV constant");
    if (Object.hasOwn(value, "dynamics")) {
      object(
        value.dynamics,
        width === 1
          ? "VfxAnimatedFloatVariableData"
          : "VfxAnimatedVector2fVariableData",
      );
      return true;
    }
    return lanes.some((n) => Math.fround(n) !== defaultValue);
  }
  function reasonsFor(obj, group) {
    const reasons = [];
    for (const [name, width, type, defaultValue] of fields[group])
      if (
        Object.hasOwn(obj, name) &&
        changed(obj[name], width, type, defaultValue)
      )
        reasons.push(name);
    const flipNames =
      group === "base"
        ? ["TextureFlipU", "TextureFlipV"]
        : ["TextureMultFilpU", "TextureMultFilpV"];
    for (const name of flipNames) {
      if (!Object.hasOwn(obj, name)) continue;
      // BIN FLAG is preserved as 0/1 by the static parser; BOOL is boolean.
      if (typeof obj[name] !== "boolean" && obj[name] !== 0 && obj[name] !== 1)
        throw Error("Invalid UV flip flag");
      if (obj[name]) reasons.push(name);
    }
    const flexNames =
      group === "base"
        ? ["flexBirthUVScrollRate", "flexBirthUVOffset"]
        : ["flexBirthUVScrollRateMult"];
    for (const flexName of flexNames) {
      if (!Object.hasOwn(obj, flexName)) continue;
      const flex = object(obj[flexName], "FlexValueVector2");
      if (
        group === "base" ||
        changed(
          Object.hasOwn(flex, "mValue")
            ? flex.mValue
            : { __type: "ValueVector2" },
          2,
          "ValueVector2",
          0,
        )
      )
        reasons.push(flexName);
    }
    return reasons;
  }
  function classify(emitter) {
    if (!emitter || typeof emitter !== "object" || Array.isArray(emitter))
      throw Error("Invalid UV emitter");
    const base = reasonsFor(emitter, "base");
    const mult = Object.hasOwn(emitter, "textureMult")
      ? reasonsFor(
          object(emitter.textureMult, "VfxTextureMultDefinitionData"),
          "mult",
        )
      : [];
    return {
      flags: { base: base.length > 0, mult: mult.length > 0 },
      reasons: { base, mult },
    };
  }
  return { classify };
}
