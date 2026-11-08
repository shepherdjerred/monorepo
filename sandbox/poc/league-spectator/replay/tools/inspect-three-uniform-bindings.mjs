// Execute the exact adapted vendor UBO manager/state functions, with a strict
// two-slot recording GL host. This establishes command/byte ownership, not GPU
// pixels; a separate native ANGLE consumer replays the exported commands.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { adaptThreeUniformBindings } from "./three-uniform-bindings.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash) throw Error(`Input drift ${path}`);
  inputs[path] = hash;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const vendorPath = `${cache}/public/vendor/three.module.upstream.js`,
  source = new TextDecoder().decode(await raw(vendorPath)),
  adapted = await adaptThreeUniformBindings(source),
  text = adapted.source.replaceAll("\r\n", "\n"),
  THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.core.js`).href
  );
await raw(`${cache}/public/vendor/three.core.js`);
assert.equal(
  await sha256(await raw(`${cache}/public/vendor/three.module.js`)),
  adapted.adaptedSha256,
  "Served vendor bytes are the exact adapted source",
);
function sliceOnce(start, end) {
  const at = text.indexOf(start);
  assert.ok(
    at >= 0 && at === text.lastIndexOf(start),
    `Unique vendor start ${start}`,
  );
  const until = text.indexOf(end, at + start.length);
  assert.ok(until > at, `Vendor end ${end}`);
  return text.slice(at, until);
}
const managerSource = sliceOnce(
    "function WebGLUniformsGroups(",
    "\n/**\n * Precomputed DFG",
  ),
  stateSource = sliceOnce(
    "\tfunction updateUBOMapping(",
    "\n\t//\n\n\tfunction reset(",
  ),
  managerFactory = new Function(
    "warn",
    "error",
    `${managerSource}\nreturn WebGLUniformsGroups;`,
  )(
    (message) => {
      throw Error(`Unexpected vendor warning ${message}`);
    },
    (message) => {
      throw Error(`Unexpected vendor error ${message}`);
    },
  ),
  stateFactory = new Function(
    "gl",
    `const uboBindings=new WeakMap(),uboProgramMap=new WeakMap();\n${stateSource}\nreturn {updateUBOMapping,uniformBlockBinding};`,
  );

const commands = [],
  rejections = [],
  draws = [],
  programs = [],
  maxBindings = 2,
  maxBlockBytes = 256;
let contextOrdinal = 0;
function host() {
  const context = ++contextOrdinal,
    buffers = new Map(),
    slots = new Map(),
    mappings = new WeakMap();
  let generic = null,
    serial = 0;
  const strict = (condition, message) => {
    if (!condition) throw Error(`StrictGL: ${message}`);
  };
  const constant = {
    UNIFORM_BUFFER: 35345,
    MAX_UNIFORM_BUFFER_BINDINGS: 35375,
    MAX_UNIFORM_BLOCK_SIZE: 35376,
    ACTIVE_UNIFORM_BLOCKS: 35382,
    UNIFORM_BLOCK_DATA_SIZE: 35392,
    LINK_STATUS: 35714,
    INVALID_INDEX: 0xffffffff,
  };
  const gl = {
    ...constant,
    getParameter(name) {
      if (name === constant.MAX_UNIFORM_BUFFER_BINDINGS) return maxBindings;
      if (name === constant.MAX_UNIFORM_BLOCK_SIZE) return maxBlockBytes;
      throw Error(`StrictGL: Unknown parameter ${name}`);
    },
    getProgramParameter(program, name) {
      strict(
        !!program &&
          typeof program === "object" &&
          Array.isArray(program.blocks),
        "linked program ownership",
      );
      if (name === constant.LINK_STATUS) return program.linked !== false;
      strict(
        name === constant.ACTIVE_UNIFORM_BLOCKS,
        "active-block reflection query",
      );
      return program.blocks.length;
    },
    isProgram(program) {
      return programs.includes(program);
    },
    getActiveUniformBlockName(program, index) {
      strict(!!program.blocks[index], "active-block index");
      return program.blocks[index].name;
    },
    getActiveUniformBlockParameter(program, index, name) {
      strict(
        name === constant.UNIFORM_BLOCK_DATA_SIZE && !!program.blocks[index],
        "data-size reflection query",
      );
      return program.blocks[index].size;
    },
    getUniformBlockIndex(program, name) {
      const index = program.blocks.findIndex((block) => block.name === name);
      return index < 0 ? constant.INVALID_INDEX : index;
    },
    createBuffer() {
      const buffer = { id: `${context}:${++serial}` };
      buffers.set(buffer, new Uint8Array());
      commands.push({ op: "createBuffer", context, buffer: buffer.id });
      return buffer;
    },
    bindBuffer(target, buffer) {
      strict(
        target === constant.UNIFORM_BUFFER &&
          (buffer === null || buffers.has(buffer)),
        "generic buffer ownership",
      );
      generic = buffer;
    },
    bufferData(target, size, usage) {
      strict(
        target === constant.UNIFORM_BUFFER &&
          buffers.has(generic) &&
          Number.isInteger(size) &&
          size > 0 &&
          size <= maxBlockBytes,
        "allocation bounds",
      );
      buffers.set(generic, new Uint8Array(size));
      commands.push({
        op: "bufferData",
        context,
        buffer: generic.id,
        size,
        usage,
      });
    },
    bufferSubData(target, offset, value) {
      strict(
        target === constant.UNIFORM_BUFFER &&
          buffers.has(generic) &&
          ArrayBuffer.isView(value),
        "upload ownership",
      );
      const bytes = new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        ),
        storage = buffers.get(generic);
      strict(
        offset >= 0 && offset + bytes.length <= storage.length,
        "upload span",
      );
      storage.set(bytes, offset);
      commands.push({
        op: "bufferSubData",
        context,
        buffer: generic.id,
        offset,
        bytesHex: bytes.toHex(),
      });
    },
    uniformBlockBinding(program, index, slot) {
      strict(
        !!program.blocks[index] &&
          Number.isInteger(slot) &&
          slot >= 0 &&
          slot < maxBindings,
        "block binding bounds",
      );
      let map = mappings.get(program);
      if (!map) mappings.set(program, (map = new Map()));
      map.set(index, slot);
      commands.push({
        op: "uniformBlockBinding",
        context,
        program: program.id,
        index,
        slot,
      });
    },
    bindBufferBase(target, slot, buffer) {
      strict(
        target === constant.UNIFORM_BUFFER &&
          Number.isInteger(slot) &&
          slot >= 0 &&
          slot < maxBindings &&
          (buffer === null || buffers.has(buffer)),
        "indexed buffer bounds/ownership",
      );
      slots.set(slot, buffer);
      commands.push({
        op: "bindBufferBase",
        context,
        slot,
        buffer: buffer?.id ?? null,
      });
    },
    deleteBuffer(buffer) {
      if (buffer == null) return;
      strict(buffers.has(buffer), "delete live owned buffer");
      buffers.delete(buffer);
      for (const [slot, entry] of slots)
        if (entry === buffer) slots.set(slot, null);
      commands.push({ op: "deleteBuffer", context, buffer: buffer.id });
    },
  };
  let stateCalls = 0;
  const info = { render: { frame: 17 } },
    nativeState = stateFactory(gl),
    state = Object.fromEntries(
      Object.entries(nativeState).map(([name, call]) => [
        name,
        (...args) => {
          stateCalls++;
          return call(...args);
        },
      ]),
    ),
    manager = managerFactory(gl, info, {}, state);
  const draw = (program, groups, label) => {
    manager.validate(groups, { program });
    for (const group of groups) {
      manager.update(group, { program });
      manager.bind(group, { program });
    }
    const blocks = program.blocks.map((block, index) => {
      const slot = mappings.get(program)?.get(index),
        buffer = slots.get(slot),
        bytes = buffers.get(buffer),
        group = groups.find((g) => g.name === block.name),
        value = group.uniforms[0].value;
      const expected = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      assert.equal(
        slot,
        index,
        "Actual reflected block index owns its bounded draw slot",
      );
      assert.ok(bytes && bytes.length >= block.size);
      assert.deepEqual(bytes, expected, "Exact raw group bytes at draw");
      return {
        index,
        name: block.name,
        size: block.size,
        slot,
        buffer: buffer.id,
        bytesHex: bytes.toHex(),
      };
    });
    const record = { op: "draw", context, program: program.id, label, blocks };
    commands.push(record);
    draws.push(record);
  };
  return {
    gl,
    info,
    manager,
    draw,
    buffers,
    slots,
    context,
    stateCalls: () => stateCalls,
  };
}
function program(id, blocks) {
  const result = { id, blocks: blocks.map(([name, size]) => ({ name, size })) };
  programs.push(result);
  return result;
}
function group(name, size, marker) {
  const data = new Float32Array(size / 4),
    bits = new Uint32Array(data.buffer);
  for (let i = 0; i < bits.length; i++)
    bits[i] = (0x3f000000 + marker * 16 + i) >>> 0;
  return new THREE.UniformsGroup()
    .setName(name)
    .setUsage(THREE.DynamicDrawUsage)
    .add(new THREE.Uniform(data));
}
const a = program("two-block-a", [
    ["Globals_vs", 64],
    ["Globals_ps", 16],
  ]),
  b = program("two-block-b-reversed", [
    ["Globals_ps", 16],
    ["Globals_vs", 64],
  ]),
  c = program("one-block-c", [["Scene", 16]]),
  h = host(),
  pairs = Array.from({ length: 128 }, (_, i) => [
    group("Globals_vs", 64, i + 1),
    group("Globals_ps", 16, i + 1000),
  ]);
for (let round = 0; round < 3; round++)
  for (const [i, pair] of pairs.entries()) {
    h.draw((i + round) % 2 ? a : b, pair, `many:${round}:${i}`);
    if (i % 16 === 0) {
      const bits = new Uint32Array(pair[0].uniforms[0].value.buffer);
      bits[0] = round % 2 ? 0 : 0x80000000;
      bits[1] = 0x7fc12345 + round;
      h.draw(a, [...pair].reverse(), `same-frame-raw-change:${round}:${i}`);
    }
  }
const single = group("Scene", 16, 7000);
h.draw(c, [single], "disjoint-layout");
h.draw(a, pairs[0], "return-to-first-layout");
const disposed = pairs[7];
for (const g of disposed) g.dispose();
h.draw(a, disposed, "same-group-recreated-after-dispose");
assert.equal(
  h.info.render.frame,
  17,
  "All draws intentionally share one Three frame",
);

function rejection(label, callback) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Required source contract rejection ${label}`);
  assert.ok(
    !caught.message.startsWith("StrictGL:"),
    `Rejected by vendor adapter before invalid GL commands: ${label}: ${caught.message}`,
  );
  rejections.push({ label, error: caught.message });
}
rejection("null group list", () => h.manager.validate(null, { program: a }));
rejection("null group", () =>
  h.manager.validate([null, pairs[0][1]], { program: a }),
);
rejection("missing active block", () =>
  h.manager.validate([pairs[0][0]], { program: a }),
);
rejection("duplicate block", () =>
  h.manager.validate([pairs[0][0], pairs[0][0]], { program: a }),
);
rejection("unknown block", () =>
  h.manager.validate([pairs[0][0], group("Foreign", 16, 1)], { program: a }),
);
rejection("undersized native storage", () =>
  h.manager.validate([group("Globals_vs", 16, 1), pairs[0][1]], { program: a }),
);
rejection("oversized native storage", () =>
  h.manager.validate([group("Globals_vs", 512, 1), pairs[0][1]], {
    program: a,
  }),
);
const excess = program("over-two-slot-limit", [
  ["A", 16],
  ["B", 16],
  ["C", 16],
]);
rejection("active program exceeds context capacity", () =>
  h.manager.validate(
    excess.blocks.map((row) => group(row.name, row.size, 1)),
    { program: excess },
  ),
);
rejection("null program", () =>
  h.manager.validate(pairs[0], { program: null }),
);
rejection("foreign program", () =>
  h.manager.validate(pairs[0], { program: { blocks: a.blocks } }),
);
const unlinked = program("unlinked-negative-only", [
  ["Globals_vs", 64],
  ["Globals_ps", 16],
]);
unlinked.linked = false;
rejection("unlinked program", () =>
  h.manager.validate(pairs[0], { program: unlinked }),
);
const empty = program("zero-block-validation-only", []);
h.manager.validate([], { program: empty });

// Context/manager disposal must release every old GPU allocation. Recreate
// from the exact same CPU groups; no old binding cache may hide fresh buffers.
h.manager.dispose();
assert.equal(h.buffers.size, 0);
for (const g of [...pairs.flat(), single])
  assert.equal(
    g._listeners?.dispose?.length ?? 0,
    0,
    "Disposed manager releases group listeners and old context closures",
  );
const restored = host();
for (let i = 0; i < 32; i++)
  restored.draw(i % 2 ? a : b, pairs[i], `new-context:${i}`);
restored.manager.dispose();
assert.equal(restored.buffers.size, 0);
for (const g of pairs.slice(0, 32).flat())
  assert.equal(
    g._listeners?.dispose?.length ?? 0,
    0,
    "Restored manager also releases group listeners",
  );
assert.equal(
  h.stateCalls() + restored.stateCalls(),
  0,
  "Adapter must bypass stale vendor UBO binding caches",
);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final drift ${path}`,
  );
const commandPath = `${cache}/research/direct-three-uniform-bindings-commands-v33.json`,
  output = `${cache}/research/direct-three-uniform-bindings-v33.json`,
  commandData = {
    schema: 1,
    kind: "exact-vendor-ubo-command-stream",
    policy: adapted.policy,
    hostLimits: { maxBindings, maxBlockBytes },
    programs,
    commands,
    scope:
      "Strict recording GL host; independent native replay required for GPU pixel evidence",
  };
await Bun.write(commandPath, JSON.stringify(commandData, null, 2) + "\n");
const result = {
  schema: 1,
  kind: "exact-vendor-bounded-uniform-bindings-control",
  policy: adapted.policy,
  upstreamSha256: adapted.upstreamSha256,
  adaptedSha256: adapted.adaptedSha256,
  inputs,
  executed: {
    managerSha256: await sha256(new TextEncoder().encode(managerSource)),
    stateSha256: await sha256(new TextEncoder().encode(stateSource)),
  },
  counts: {
    draws: draws.length,
    groups: 257,
    contexts: contextOrdinal,
    commands: commands.length,
    rejections: rejections.length,
    maxBindings,
    maxBlockBytes,
  },
  rejections,
  commandPath,
  commandSha256: await sha256(await Bun.file(commandPath).bytes()),
  mismatches: [],
  scope: {
    exactVendorManager: true,
    vendorStateUboCalls: h.stateCalls() + restored.stateCalls(),
    bypassesVendorStateUboCache: true,
    realWebGL: false,
    gpuPixels: false,
    browserAcceptance: false,
  },
};
await Bun.write(output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({ output, commandPath, counts: result.counts, mismatches: 0 }),
);
