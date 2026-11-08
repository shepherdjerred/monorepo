import { sha256 } from "./structural-comparison.mjs";
export const DIRECT_NAV_SCENE_SHADER_REFS = Object.freeze({
  vertex: Object.freeze({
    dxbc: "ea6fba36ce6d661beb55e8b2aa4856753a04bb6a8862b022387d7a027288b22a",
    sha256: "24ff69e72e06b8a3905b6d1c3c6cb3349cbd6bb0d2e48a1ba7a2b9a5e24e7699",
  }),
  fade: Object.freeze({
    dxbc: "98a98b9fb3b0f8ac1e60d1d2c1d986f6e5f245bc4f6c2d8d1c3b2ff0462ab3e5",
    sha256: "08ebf5c027bf1c578d3601ed74de282d28774831c7ecd3dac18cc8c20afd37a6",
  }),
  blur: Object.freeze({
    dxbc: "8d191c51e4cecea3adb01c254a8778c487fe835a483699a74456bd029efe18cc",
    sha256: "70492d0c0732094348d000988f3900b5e6a435f3c1cc87207cfb7f2c5c856c53",
  }),
});
export const DIRECT_NAV_SCENE_SAMPLER = Object.freeze({
  name: "NAVMESH_MASK_TEXTURE_SharedSampler",
  descriptorHex: "01010100000000000100010100000000",
  nativeProofSha256:
    "20ef432bb2ce9aa53b114e3f4fb80c97fe1026d17ebeb6e1353473ca233d3ab6",
  parameters: Object.freeze({
    10242: 33071,
    10243: 33071,
    32882: 33071,
    10241: 9729,
    10240: 9729,
  }),
  publicationCallsite: Object.freeze([0x745c18, 0x745c42]),
  originalSetterRva: 0x1917340,
  originalBackendSamplerPrefix: Object.freeze([0x192c710, 0x192c77d]),
});
const stagesOwned = new WeakSet();
export const isDirectNavSceneGpuProgram = (v) =>
  v !== null && typeof v === "object" && stagesOwned.has(v);
export async function loadDirectNavSceneGpuProgram({ load }) {
  if (typeof load !== "function")
    throw Error("Exact nav GPU stage loader required");
  const stages = {};
  for (const [name, ref] of Object.entries(DIRECT_NAV_SCENE_SHADER_REFS)) {
    const bytes = await load(
      `latest-shared-shaders-navmask-v29/stages/${ref.dxbc}.json`,
    );
    if (!(bytes instanceof Uint8Array) || (await sha256(bytes)) !== ref.sha256)
      throw Error(`Exact nav GPU ${name} translation changed`);
    const stage = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!stage.glsl.startsWith("#version 300 es\n"))
      throw Error("Original GLES nav shader required");
    stages[name] = stage;
  }
  const source = stages.vertex.glsl;
  if (
    (await sha256(new TextEncoder().encode(source))) !==
    "02fbee75855817ce9d7d2199b60a3416899b2e71e18359ac0bc9fd7aa572a2ee"
  )
    throw Error("Original fullscreen resource-coordinate shader changed");
  const original = "    gl_Position.y = _31;";
  if (source.split(original).length !== 2)
    throw Error("Unique native fullscreen clip assignment required");
  const adapted = source.replace(original, "    gl_Position.y = -_31;");
  if (
    (await sha256(new TextEncoder().encode(adapted))) !==
    "789b68ee7faab14b6ff2f54df81454d623badfdcde11d3a8987e74a66984612f"
  )
    throw Error("Resource row-coordinate specialization changed");
  const program = Object.freeze({
    vertex: stages.vertex,
    fade: stages.fade,
    blur: stages.blur,
    vertexBody: adapted.slice("#version 300 es\n".length),
    fadeBody: stages.fade.glsl.slice("#version 300 es\n".length),
    blurBody: stages.blur.glsl.slice("#version 300 es\n".length),
    coordinatePolicy:
      "metal-upper-left-resource-rows-to-gles-clip-y-negated-v1",
  });
  stagesOwned.add(program);
  return program;
}

export function validateDirectNavSceneGpuPasses(frame) {
  const p = frame?.plan;
  if (
    !p ||
    p.passes?.length !== 5 ||
    p.upload !== null ||
    p.targetLifetime !== "per-update-pool-lease" ||
    !Number.isInteger(p.width) ||
    !Number.isInteger(p.height) ||
    p.width !== frame.metadata?.width ||
    p.height !== frame.metadata?.height
  )
    throw Error("Exact same-size owned five-pass nav plan required");
  const expected = [
    [
      "fade",
      "output",
      { current: "mask-b", target: "mask-a" },
      { current: "clamp-nearest", target: "clamp-linear" },
    ],
    ["blur", "scratch", { source: "output" }, { source: "clamp-linear" }],
    ["blur", "output", { source: "scratch" }, { source: "clamp-linear" }],
    ["blur", "scratch", { source: "output" }, { source: "clamp-linear" }],
    ["blur", "output", { source: "scratch" }, { source: "clamp-linear" }],
  ];
  for (const [i, command] of p.passes.entries()) {
    if (
      JSON.stringify([
        command.shader,
        command.target,
        command.textures,
        command.samplers,
      ]) !== JSON.stringify(expected[i]) ||
      !Array.isArray(command.parameters) ||
      command.parameters.length !== 4 ||
      ![0, 1, 2, 3].every(
        (k) =>
          Object.hasOwn(command.parameters, k) &&
          typeof command.parameters[k] === "number" &&
          Number.isFinite(Math.fround(command.parameters[k])),
      )
    )
      throw Error("Exact original Fade/HV/HV nav pass DAG required");
  }
  return p;
}
