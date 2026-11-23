// Signatures match the pinned Toolkit readers. DDS header layout is specified
// at https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header and
// https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header-dxt10.
// Identifying a format does not admit its native material or sampler behavior.
export function identifyArchivedFxFormat(bytes) {
  if (!(bytes instanceof Uint8Array)) throw Error("Original FX bytes required");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    text = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes.length >= 4 && view.getUint32(0, true) === 0x00584554) {
    if (bytes.length < 12) throw Error("Truncated original TEX header");
    const width = view.getUint16(4, true),
      height = view.getUint16(6, true),
      extendedFormat = bytes[9],
      resourceType = bytes[10];
    if (!width || !height) throw Error("Original TEX dimensions are empty");
    return {
      format: "tex",
      width,
      height,
      extendedFormat,
      resourceType,
      translation:
        resourceType !== 0
          ? "unsupported-texture-resource-type"
          : [10, 11, 12, 13, 14, 20].includes(extendedFormat)
            ? "pinned-texture-mip0"
            : "unsupported-tex-compression-format",
    };
  }
  if (bytes.length >= 4 && text(0, 4) === "DDS ") {
    if (
      bytes.length < 128 ||
      view.getUint32(4, true) !== 124 ||
      view.getUint32(76, true) !== 32
    )
      throw Error("Truncated or invalid original DDS header");
    const width = view.getUint32(16, true),
      height = view.getUint32(12, true),
      caps2 = view.getUint32(112, true),
      depth = view.getUint32(24, true),
      dx10 = text(84, 88) === "DX10";
    if (!width || !height) throw Error("Original DDS dimensions are empty");
    if (dx10 && bytes.length < 148)
      throw Error("Truncated original DDS DX10 header");
    const dimension = dx10 ? view.getUint32(132, true) : null,
      arraySize = dx10 ? view.getUint32(140, true) : 1,
      cube =
        (caps2 & 0xfe00) !== 0 ||
        (dx10 && (view.getUint32(136, true) & 4) !== 0),
      volume = (caps2 & 0x200000) !== 0 || depth > 1,
      single2d =
        !cube && !volume && arraySize === 1 && (!dx10 || dimension === 3);
    return {
      format: "dds",
      width,
      height,
      caps2,
      depth,
      dimension,
      arraySize,
      translation: single2d
        ? "pinned-texture-mip0"
        : "unsupported-texture-resource-type",
    };
  }
  if (bytes.length >= 12 && text(0, 8) === "r3d2Mesh")
    return {
      format: "scb",
      major: view.getUint16(8, true),
      minor: view.getUint16(10, true),
      translation: "pinned-static-mesh",
    };
  if (bytes.length >= 13 && text(0, 13) === "[ObjectBegin]")
    return { format: "sco", translation: "pinned-static-mesh" };
  if (bytes.length >= 12 && ["r3d2canm", "r3d2anmd"].includes(text(0, 8)))
    return {
      format: "anm",
      magic: text(0, 8),
      version: view.getUint32(8, true),
      translation: "unsupported-vfx-animation-binding",
    };
  if (bytes.length >= 12 && view.getUint32(0, true) === 0x00112233)
    return {
      format: "skn",
      major: view.getUint16(4, true),
      minor: view.getUint16(6, true),
      translation: "unsupported-vfx-skinned-mesh-binding",
    };
  if (bytes.length >= 12 && view.getUint32(4, true) === 0x22fd4fc3)
    return {
      format: "skl",
      version: view.getUint32(8, true),
      translation: "unsupported-vfx-rig-binding",
    };
  return {
    format: "unknown",
    signatureHex: [...bytes.subarray(0, 16)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
    translation: "unsupported-original-format",
  };
}
