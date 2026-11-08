// Exact-build particle address selectors. Mip, LOD, anisotropy and original
// shader/GPU behavior are separate; border mode remains explicitly unrendered.
export function createLatestVfxSamplers(definition) {
  const expected = [
    {
      authored: 0,
      engine: 0,
      metal: 2,
      name: "repeat",
      previewSupported: true,
    },
    {
      authored: 1,
      engine: 2,
      metal: 3,
      name: "mirror",
      previewSupported: true,
    },
    { authored: 2, engine: 1, metal: 0, name: "clamp", previewSupported: true },
    {
      authored: 3,
      engine: 3,
      metal: 5,
      name: "border",
      previewSupported: false,
    },
  ];
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.descriptorBlock?.join(",") !== `${0x16e3910},${0x16e3a53}` ||
    definition.lookupBlock?.join(",") !== `${0x1927db7},${0x1927dc2}` ||
    definition.defaults?.base !== 0 ||
    definition.defaults?.mult !== 0 ||
    definition.defaults?.pixelated !== false ||
    JSON.stringify(definition.addressModes) !== JSON.stringify(expected)
  )
    throw Error("Unsupported VFX sampler package");
  function describe(emitter, layer) {
    if (
      !emitter ||
      typeof emitter !== "object" ||
      Array.isArray(emitter) ||
      !["base", "mult"].includes(layer)
    )
      throw Error("Invalid particle sampler input");
    const source =
      layer === "base"
        ? emitter
        : Object.hasOwn(emitter, "textureMult")
          ? emitter.textureMult
          : { __type: "VfxTextureMultDefinitionData" };
    if (
      !source ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      (layer === "mult" && source.__type !== "VfxTextureMultDefinitionData")
    )
      throw Error("Invalid multiply sampler definition");
    const field =
      layer === "base" ? "texAddressModeBase" : "texAddressModeMult";
    const authored = Object.hasOwn(source, field)
      ? source[field]
      : definition.defaults[layer];
    if (!Number.isInteger(authored) || authored < 0 || authored > 3)
      throw Error("Unknown particle texture address enum");
    const pixel = Object.hasOwn(emitter, "isTexturePixelated")
      ? emitter.isTexturePixelated
      : definition.defaults.pixelated;
    if (typeof pixel !== "boolean" && pixel !== 0 && pixel !== 1)
      throw Error("Invalid particle pixelation selector");
    const mode = expected[authored],
      filter = pixel ? 0 : 1;
    const descriptorHex = [
      mode.engine,
      mode.engine,
      mode.engine,
      filter,
      filter,
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    return { ...mode, pixelated: !!pixel, descriptorHex };
  }
  return { describe };
}

export function latestVfxTextureKey(asset, sampler) {
  if (
    !asset ||
    typeof asset.file !== "string" ||
    !sampler?.previewSupported ||
    !["repeat", "mirror", "clamp"].includes(sampler.name)
  )
    throw Error("Unsupported prepared particle texture state");
  return `${asset.file}:${sampler.authored}:${sampler.pixelated ? 1 : 0}`;
}
