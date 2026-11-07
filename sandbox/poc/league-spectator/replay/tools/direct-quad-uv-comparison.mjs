// Native camera/arbitrary vertex layout: four atlas halfwords at16, then two
// palette halfwords at24. Keep all six in each numerical comparison gate.
export function compareDirectQuadUv(attributes, raw, context, mismatches) {
  const vertices = raw.byteLength / 28;
  if (
    !(raw instanceof Uint8Array) ||
    !Number.isInteger(vertices) ||
    !(attributes.a_TEXCOORD instanceof Uint16Array) ||
    attributes.a_TEXCOORD.length !== vertices * 4 ||
    !(attributes.a_TEXCOORD1 instanceof Uint16Array) ||
    attributes.a_TEXCOORD1.length !== vertices * 2 ||
    !Array.isArray(mismatches)
  )
    throw Error("Exact native quad UV layout required");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let vertex = 0; vertex < vertices; vertex++)
    for (let lane = 0; lane < 6; lane++) {
      const actual =
          lane < 4
            ? attributes.a_TEXCOORD[vertex * 4 + lane]
            : attributes.a_TEXCOORD1[vertex * 2 + lane - 4],
        expected = view.getUint16(vertex * 28 + 16 + lane * 2, true);
      if (actual !== expected)
        mismatches.push({
          ...context,
          kind: "packed-quad-uv",
          vertex,
          lane,
          actual,
          expected,
        });
    }
  return vertices * 6;
}
