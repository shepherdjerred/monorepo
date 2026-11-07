import { test, expect } from "bun:test";
import { beginDirectDrawCapture } from "./latest-direct-draw-diagnostics.mjs";
import * as THREE from "../../../../.cache/replay-spike/public/vendor/three.core.js";

const identity = () => ({
  elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});
function fixture() {
  const bytes = new Float32Array([-0, 2, 3]);
  let callbacks = 0;
  const mesh = {
    id: 19,
    visible: true,
    renderOrder: 5,
    matrixWorld: identity(),
    modelViewMatrix: identity(),
    normalMatrix: identity(),
    material: {
      id: 12,
      name: "test",
      transparent: true,
      uniforms: {
        tex: {
          value: { isTexture: true, id: 99, image: { width: 1, height: 1 } },
        },
      },
      uniformsGroups: [{ name: "Block", uniforms: [{ value: bytes }] }],
    },
    geometry: {
      attributes: { position: { array: bytes, itemSize: 3, count: 1 } },
      index: { array: new Uint16Array([0, 0, 0]) },
      drawRange: { start: 0, count: 3 },
    },
    onAfterRender() {
      callbacks++;
    },
  };
  const camera = {
    matrixWorldInverse: identity(),
    projectionMatrix: identity(),
  };
  const packet = {
    time: 82.35,
    draws: [{ sourceEventId: "a", positions: bytes.subarray(0, 1) }],
  };
  return { mesh, camera, packet, bytes, callbacks: () => callbacks };
}

test("capture copies exact packet/geometry/UBO spans before asynchronous hashing and restores callbacks", async () => {
  const f = fixture(),
    previous = f.mesh.onAfterRender;
  const capture = beginDirectDrawCapture(
    f.packet,
    { directMeshes: new Map([["a:1:0", f.mesh]]) },
    f.camera,
  );
  f.mesh.onAfterRender();
  capture.stop();
  expect(f.mesh.onAfterRender).toBe(previous);
  expect(f.callbacks()).toBe(1);
  f.bytes.fill(100);
  const report = await capture.report();
  const expected = new Uint8Array(new Float32Array([-0]).buffer);
  const digest = Buffer.from(
    await crypto.subtle.digest("SHA-256", expected),
  ).toString("hex");
  expect(report.packetDraws[0].positions).toEqual({
    type: "Float32Array",
    byteLength: 4,
    sha256: digest,
  });
  const draw = report.submissions[0];
  expect(draw.attributes.position.array.sha256).toBe(
    draw.uniformGroups[0].values[0].sha256,
  );
  expect(draw.meshId).toBe(19);
  expect(draw.uniforms.tex.id).toBe(99);
  expect(draw.renderOrder).toBe(5);
  expect(report.submissions).toHaveLength(1);
});

test("deferred navigation commit is captured after mesh creation in actual submission order", async () => {
  const f = fixture(),
    meshes = new Map();
  const renderer = {
    pendingCombat: true,
    navGroundRenderer: { meshes },
    submitStagedDirect() {
      meshes.set("a:1:0", f.mesh);
      this.pendingCombat = null;
    },
  };
  const previous = renderer.submitStagedDirect;
  const capture = beginDirectDrawCapture(f.packet, renderer, f.camera);
  await expect(capture.report()).rejects.toThrow("Stop diagnostic");
  renderer.submitStagedDirect();
  f.mesh.onAfterRender();
  capture.stop();
  expect(renderer.submitStagedDirect).toBe(previous);
  expect((await capture.report()).submissions[0].owner).toBe("navigation");
  expect(() => capture.stop()).toThrow("already stopped");
});

test("GPU block readback restores COPY_READ_BUFFER and owns exact copied bytes", async () => {
  const f = fixture(),
    program = {},
    buffer = {},
    previous = {},
    bytes = Uint8Array.of(0, 0, 0, 128);
  let current = previous;
  const gl = {
    CURRENT_PROGRAM: 1,
    COPY_READ_BUFFER_BINDING: 2,
    COPY_READ_BUFFER: 3,
    ACTIVE_UNIFORM_BLOCKS: 4,
    UNIFORM_BLOCK_BINDING: 5,
    UNIFORM_BLOCK_DATA_SIZE: 6,
    UNIFORM_BUFFER_BINDING: 7,
    BUFFER_SIZE: 8,
    ACTIVE_TEXTURE: 9,
    ACTIVE_UNIFORMS: 10,
    getParameter: (name) => (name === 1 ? program : name === 2 ? current : 0),
    getProgramParameter: (_, name) => (name === 4 ? 1 : 0),
    getActiveUniformBlockName: () => "Block",
    getActiveUniformBlockParameter: (_, __, name) => (name === 5 ? 2 : 4),
    getIndexedParameter: () => buffer,
    bindBuffer: (_, value) => {
      current = value;
    },
    getBufferParameter: () => 4,
    getBufferSubData: (_, __, output) => {
      expect(current).toBe(buffer);
      output.set(bytes);
    },
    activeTexture: () => {},
  };
  const capture = beginDirectDrawCapture(
    f.packet,
    { directMeshes: new Map([["a", f.mesh]]) },
    f.camera,
    { webglRenderer: { getContext: () => gl } },
  );
  f.mesh.onAfterRender();
  expect(current).toBe(previous);
  capture.stop();
  bytes.fill(0);
  const report = await capture.report();
  const expected = Buffer.from(
    await crypto.subtle.digest("SHA-256", Uint8Array.of(0, 0, 0, 128)),
  ).toString("hex");
  expect(report.submissions[0].gpuUniformBlocks[0].bytes.sha256).toBe(expected);
  expect(report.gpuReadbackCpuMs).toBeGreaterThanOrEqual(0);
});

test("world skinning initial/draw snapshots are independent and preserve matrix bytes", async () => {
  const scene = new THREE.Scene(),
    bone = new THREE.Bone(),
    mesh = new THREE.SkinnedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    ),
    skeleton = new THREE.Skeleton([bone]);
  mesh.add(bone);
  mesh.bind(skeleton);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  skeleton.update();
  const camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld();
  const capture = beginDirectDrawCapture({ time: 1, draws: [] }, {}, camera, {
    scene,
  });
  bone.position.y = 7;
  scene.updateMatrixWorld(true);
  skeleton.update();
  mesh.onAfterRender(null, scene, camera, mesh.geometry, mesh.material);
  capture.stop();
  skeleton.boneMatrices.fill(0);
  const report = await capture.report();
  expect(report.worldSubmissions).toHaveLength(1);
  expect(report.worldSkinningInitial).toHaveLength(1);
  expect(report.worldSkinningInitial[0].boneMatrices.sha256).not.toBe(
    report.worldSubmissions[0].skinning.boneMatrices.sha256,
  );
  expect(report.worldSubmissions[0].skinning.boneWorldMatrices.byteLength).toBe(
    128,
  );
});

test("capture observes clear calls and removes inherited GL wrapper exactly", async () => {
  let mask = null;
  const prototype = {
      clear(value) {
        mask = value;
      },
    },
    gl = Object.create(prototype);
  const capture = beginDirectDrawCapture(
    { time: 1, draws: [] },
    {},
    {},
    { webglRenderer: { getContext: () => gl } },
  );
  gl.clear(0x4100);
  capture.stop();
  expect(Object.hasOwn(gl, "clear")).toBe(false);
  expect(gl.clear).toBe(prototype.clear);
  expect(mask).toBe(0x4100);
  expect((await capture.report()).clearCalls).toEqual([
    { mask: 0x4100, afterWorldSubmissionCount: 0, state: null },
  ]);
});

test("actual attribute/index binding probe reads driver buffers and restores copy-read binding", async () => {
  const f = fixture(),
    program = {},
    vao = {},
    vertex = {},
    index = {},
    previous = {};
  let current = previous;
  const names = [
    "CURRENT_PROGRAM",
    "COPY_READ_BUFFER_BINDING",
    "COPY_READ_BUFFER",
    "ACTIVE_UNIFORM_BLOCKS",
    "ACTIVE_UNIFORMS",
    "ACTIVE_ATTRIBUTES",
    "VERTEX_ARRAY_BINDING",
    "ELEMENT_ARRAY_BUFFER_BINDING",
    "VERTEX_ATTRIB_ARRAY_BUFFER_BINDING",
    "CURRENT_VERTEX_ATTRIB",
    "ACTIVE_TEXTURE",
  ];
  const gl = Object.fromEntries(names.map((name) => [name, name]));
  Object.assign(gl, {
    getParameter: (name) =>
      ({
        CURRENT_PROGRAM: program,
        COPY_READ_BUFFER_BINDING: current,
        VERTEX_ARRAY_BINDING: vao,
        ELEMENT_ARRAY_BUFFER_BINDING: index,
      })[name] ?? 0,
    getProgramParameter: (_, name) => (name === "ACTIVE_ATTRIBUTES" ? 1 : 0),
    getActiveAttrib: () => ({ name: "a_POSITION", type: 35665, size: 1 }),
    getAttribLocation: () => 2,
    getVertexAttrib: (_, name) =>
      name === "VERTEX_ATTRIB_ARRAY_BUFFER_BINDING"
        ? vertex
        : name === "CURRENT_VERTEX_ATTRIB"
          ? new Float32Array([0, 0, 0, 1])
          : 0,
    getVertexAttribOffset: () => 12,
    bindBuffer: (_, value) => {
      current = value;
    },
    getBufferParameter: () => (current === vertex ? 8 : 2),
    getBufferSubData: (_, __, output) => {
      output.fill(current === vertex ? 0x80 : 0xff);
    },
    activeTexture: () => {},
  });
  const capture = beginDirectDrawCapture(
    f.packet,
    { directMeshes: new Map([["a", f.mesh]]) },
    f.camera,
    { webglRenderer: { getContext: () => gl } },
  );
  f.mesh.onAfterRender();
  expect(current).toBe(previous);
  capture.stop();
  const geometry = (await capture.report()).submissions[0].gpuGeometry;
  expect(geometry.attributes[0].offset).toBe(12);
  expect(geometry.attributes[0].buffer.bytes.byteLength).toBe(8);
  expect(geometry.index.bytes.byteLength).toBe(2);
  expect(geometry.attributes[0].buffer.bytes.sha256).not.toBe(
    geometry.index.bytes.sha256,
  );
});
