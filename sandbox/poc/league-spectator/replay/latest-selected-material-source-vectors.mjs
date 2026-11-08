// Original static parameter/sampler reads only. This helper does not approve
// authored-source lowering, shader selection, rendering, or material admission.
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
const f = Math.fround,
  need = (v, m) => {
    if (!v) throw Error(m);
  };
function bytes(hex) {
  need(
    typeof hex === "string" && /^(?:[a-f0-9]{2})+$/.test(hex),
    "Exact material source bytes required",
  );
  return Uint8Array.fromHex(hex);
}
function vector(name, values) {
  need(
    values.length === 4 && values.every(Number.isFinite),
    "Finite derived material vectors required",
  );
  const b = new Uint8Array(16),
    v = new DataView(b.buffer);
  values.forEach((n, i) => v.setFloat32(i * 4, n, true));
  need(
    values.every((n, i) => Object.is(v.getFloat32(i * 4, true), n)),
    "Exact derived float32 material vectors required",
  );
  return { name, bytesHex: b.toHex(), value: values };
}
export function deriveSelectedMaterialSourceVectors(graph) {
  assertDirectCompiledDataGraph(graph);
  const object = bytes(graph.assetObjectHex),
    segments = graph.segments.map((s) => ({
      address: s.address,
      bytes: bytes(s.bytesHex),
    }));
  need(
    object.length === 0x470 && graph.addresses?.definition === 0x10020000,
    "Original material source root layout required",
  );
  segments.sort((a, b) => a.address - b.address);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    need(
      Number.isSafeInteger(s.address) &&
        s.address >= 0 &&
        Number.isSafeInteger(s.address + s.bytes.length),
      "Bounded material source segment required",
    );
    if (i)
      need(
        segments[i - 1].address + segments[i - 1].bytes.length <= s.address,
        "Overlapping material source segments are ambiguous",
      );
  }
  function span(address, size) {
    need(
      Number.isSafeInteger(address) && Number.isSafeInteger(address + size),
      "Bounded material source pointer required",
    );
    const owners = segments.filter(
      (s) =>
        address >= s.address && address + size <= s.address + s.bytes.length,
    );
    need(
      owners.length === 1,
      "Material input must have exactly one original graph owner",
    );
    const s = owners[0];
    return s.bytes.subarray(address - s.address, address - s.address + size);
  }
  need(
    sameDirectCompiledData(
      span(graph.addresses.definition, object.length),
      object,
    ),
    "Material source root differs from its owned segment",
  );
  const root = new DataView(object.buffer),
    pointer = (offset) => {
      const p = root.getBigUint64(offset, true);
      need(
        p <= BigInt(Number.MAX_SAFE_INTEGER),
        "Bounded material source pointer required",
      );
      return Number(p);
    },
    view = (address, size) => {
      const b = span(address, size);
      return new DataView(b.buffer, b.byteOffset, b.byteLength);
    },
    mult = pointer(0x230) ? view(pointer(0x230), 0x19) : null,
    soft = pointer(0x30) ? view(pointer(0x30), 0x11) : null;
  need(
    pointer(0x38) === 0,
    "Selected basic quad source vectors do not admit erosion",
  );
  need(
    object[0x12] === 0 || object[0x12] === 1,
    "Original material pixelated bool required",
  );
  const finiteFloat = (view, offset) => {
    const n = view.getFloat32(offset, true);
    need(Number.isFinite(n), "Finite serialized material float required");
    return n;
  };
  const atlas = (columns, rows) => [
      columns,
      columns === 0 ? 0 : f(1 / columns),
      rows === 0 ? 0 : f(1 / rows),
      0,
    ],
    parameters = [
      vector(
        "TEXTURE_INFO",
        atlas(finiteFloat(root, 0x8c), finiteFloat(root, 0x90)),
      ),
      vector(
        "TEXTURE_INFO_2",
        atlas(
          mult ? finiteFloat(mult, 0x10) : 1,
          mult ? finiteFloat(mult, 0x14) : 1,
        ),
      ),
      vector("PARTICLE_DEPTH_PUSH_PULL", [finiteFloat(root, 0x33c), 0, 0, 0]),
    ];
  if (soft) {
    const a = finiteFloat(soft, 4),
      b = finiteFloat(soft, 8),
      c = finiteFloat(soft, 12),
      eps = f(1e-8),
      kind = soft.getInt8(0x10),
      table = [
        [0, 1, 0, 1],
        [0, 1, 1, 0],
        [1, 0, 0, 1],
      ];
    parameters.push(
      vector("cSoftParticleParams", [
        finiteFloat(soft, 0),
        a > 0 ? a : 1e8,
        b > eps ? f(1 / b) : 1e8,
        c > eps ? f(1 / c) : 1e8,
      ]),
      vector("cSoftParticleControl", table[kind] ?? [0, 0, 0, 0]),
    );
  }
  const sampler = (value) => {
    const address = [0, 2, 1, 3][value] ?? 0,
      filter = object[0x12] ^ 1;
    return Uint8Array.of(address, address, address, filter, filter).toHex();
  };
  return {
    parameters,
    samplers: [
      { layer: "base", slot: 0, descriptorHex: sampler(object[0xc9]) },
      {
        layer: "mult",
        slot: 7,
        descriptorHex: sampler(mult ? mult.getUint8(0x18) : 0),
      },
    ],
    erosionAtSuppliedDrive: null,
    erosionParameters: [],
  };
}
export function assertSelectedMaterialSourceVectors(graph, observation) {
  assertDirectCompiledDataGraph(observation);
  const expected = deriveSelectedMaterialSourceVectors(graph);
  for (const key of [
    "parameters",
    "samplers",
    "erosionAtSuppliedDrive",
    "erosionParameters",
  ])
    need(
      sameDirectCompiledData(observation[key], expected[key]),
      "Native static material " + key + " differs from serialized source reads",
    );
  return true;
}
