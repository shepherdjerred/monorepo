// Actual owned static renderer resources through the installed THREE uniform
// parser/filter/upload/setter path. A separate GLES replay consumes these exact
// unit assignments and texture bytes to establish failing/valid GPU draws.
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
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
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const producer = resolve(
    import.meta.dir,
    "inspect-direct-static-mesh-renderer.mjs",
  ),
  source = new TextDecoder().decode(await raw(producer)),
  boundary = "const meshes = [...renderer.meshes.values()];";
assert.equal(source.indexOf(boundary), source.lastIndexOf(boundary));
assert.ok(source.indexOf(boundary) > 0);
const setup = source
    .slice(0, source.indexOf(boundary))
    .replace(
      /\bfrom\s+(["'])(\.{1,2}\/[^"']+)\1/g,
      (_m, _q, p) =>
        `from ${JSON.stringify(pathToFileURL(resolve(dirname(producer), p)).href)}`,
    )
    .replaceAll("import.meta.dir", JSON.stringify(dirname(producer)))
    .replaceAll("import.meta.path", JSON.stringify(producer))
    .replaceAll(
      "direct-static-mesh-renderer.bundle.mjs",
      "direct-sampler-upload-fixture.bundle.mjs",
    ),
  setupPath = `${cache}/research/direct-three-sampler-upload.setup.mjs`;
await Bun.write(
  setupPath,
  setup + "\nexport {inputs,renderer,program,THREE};\n",
);
const fixture = await import(pathToFileURL(setupPath).href);
Object.assign(inputs, fixture.inputs);
await raw(setupPath);
const material = [...fixture.renderer.meshes.values()][0].material,
  binding = fixture.renderer.bindings.get(fixture.program.materialKey),
  vertex = binding.stages[0].glsl,
  pixel = binding.stages[1].glsl,
  pairSha256 = await sha256(new TextEncoder().encode(vertex + "\0" + pixel)),
  reflection = await read(
    `${cache}/research/direct-sampler-reflection-gles-v33.json`,
  ),
  selected = reflection.materials.find(
    (row) => row.materialKey === fixture.program.materialKey,
  );
assert.ok(selected);
assert.equal(selected.shaderPairSha256, pairSha256);
assert.equal(selected.activeSamplers.length, 5);
assert.equal(new Set(selected.activeSamplers.map((s) => s.glType)).size, 2);
const vendor = new TextDecoder().decode(
    await raw(`${cache}/public/vendor/three.module.js`),
  ),
  start = vendor.indexOf("const emptyTexture ="),
  end = vendor.indexOf("function WebGLShader(", start),
  uniformSource = vendor.slice(start, end);
assert.ok(start > 0 && end > start);
assert.equal(vendor.indexOf("const emptyTexture =", start + 1), -1);
const names = [
    "Texture",
    "DepthTexture",
    "DataArrayTexture",
    "Data3DTexture",
    "CubeTexture",
    "GreaterEqualCompare",
    "LessEqualCompare",
  ],
  WebGLUniforms = new Function(
    ...names,
    uniformSource + "\nreturn WebGLUniforms;",
  )(...names.map((name) => fixture.THREE[name]));
const upstream = new TextDecoder().decode(
    await raw(`${cache}/public/vendor/three.module.upstream.js`),
  ),
  upstreamUniformSource = upstream.slice(
    upstream.indexOf("const emptyTexture ="),
    upstream.indexOf(
      "function WebGLShader(",
      upstream.indexOf("const emptyTexture ="),
    ),
  ),
  HistoricalUniforms = new Function(
    ...names,
    upstreamUniformSource + "\nreturn WebGLUniforms;",
  )(...names.map((name) => fixture.THREE[name])),
  guardStart = vendor.indexOf("const REPLAY_SAMPLER_FORMATS ="),
  guardEnd = vendor.indexOf(
    "\nexport const REPLAY_UNIFORM_BINDINGS_POLICY",
    guardStart,
  );
assert.ok(guardStart > 0 && guardEnd > guardStart);
const guardSource = vendor.slice(guardStart, guardEnd),
  formatNames = [
    "RedIntegerFormat",
    "RGIntegerFormat",
    "RGBAIntegerFormat",
    "UnsignedByteType",
    "UnsignedShortType",
    "UnsignedIntType",
  ],
  guard = new Function(
    ...formatNames,
    guardSource +
      "\nreturn {validate:assertReplaySamplerUniforms,formats:REPLAY_SAMPLER_FORMATS};",
  )(...formatNames.map((name) => fixture.THREE[name]));
assert.equal(
  (
    vendor.match(
      /assertReplaySamplerUniforms\( p_uniforms.seq, m_uniforms, material, program, REPLAY_SAMPLER_FORMATS, true \)/g,
    ) ?? []
  ).length,
  2,
  "Both actual upload dispatches use current-value guards",
);
assert.ok(
  vendor.includes(
    "assertReplaySamplerUniforms( replayProgram.getUniforms().seq, materialProperties.uniforms, material, replayProgram, REPLAY_SAMPLER_FORMATS, false )",
  ),
);
let uploadCommands = 0;
const guardControls = [];
const textures = [],
  textureIds = new WeakMap(),
  glWrap = new Map([
    [1000, 10497],
    [1001, 33071],
    [1002, 33648],
  ]),
  glFilter = new Map([
    [1003, 9728],
    [1006, 9729],
    [1004, 9984],
    [1005, 9986],
    [1007, 9985],
    [1008, 9987],
  ]);
function textureId(texture) {
  if (textureIds.has(texture)) return textureIds.get(texture);
  assert.equal(texture?.isTexture, true);
  assert.ok(
    texture.image && ArrayBuffer.isView(texture.image.data),
    "Owned actual data texture required",
  );
  const id = `texture:${textures.length}`,
    data = texture.image.data;
  const record = {
    id,
    width: texture.image.width,
    height: texture.image.height,
    format: texture.format,
    type: texture.type,
    internalFormat: texture.internalFormat,
    integer: texture.format === fixture.THREE.RedIntegerFormat,
    dimension: "2d",
    bytesHex: new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).toHex(),
    mipmaps: (texture.mipmaps ?? []).map((level) => ({
      width: level.width,
      height: level.height,
      bytesHex: new Uint8Array(
        level.data.buffer,
        level.data.byteOffset,
        level.data.byteLength,
      ).toHex(),
    })),
    glParameters: {
      10240: glFilter.get(texture.magFilter),
      10241: glFilter.get(texture.minFilter),
      10242: glWrap.get(texture.wrapS),
      10243: glWrap.get(texture.wrapT),
    },
    flipY: texture.flipY,
    colorSpace: texture.colorSpace,
  };
  assert.ok(Object.values(record.glParameters).every(Number.isInteger));
  textureIds.set(texture, id);
  textures.push(record);
  return id;
}
function upload(values, label, guarded = true) {
  const locations = new Map(
      selected.activeSamplers.map((sampler) => [
        sampler.name,
        { name: sampler.name, unit: 0 },
      ]),
    ),
    bound = new Map(),
    commands = [];
  let nextUnit = 0;
  const gl = {
    ACTIVE_UNIFORMS: 35718,
    SAMPLER_2D_SHADOW: 35682,
    SAMPLER_CUBE_SHADOW: 36293,
    SAMPLER_2D_ARRAY_SHADOW: 36292,
    getProgramParameter: (_program, name) => {
      assert.equal(name, 35718);
      return selected.activeSamplers.length;
    },
    getActiveUniform: (_program, index) => {
      const row = selected.activeSamplers[index];
      return { name: row.name, type: row.glType, size: row.size };
    },
    getUniformLocation: (_program, name) => locations.get(name),
    uniform1i: (location, unit) => {
      uploadCommands++;
      assert.ok(locations.get(location.name) === location);
      assert.ok(Number.isInteger(unit) && unit >= 0 && unit < 16);
      location.unit = unit;
      commands.push({ op: "uniform1i", name: location.name, unit });
    },
  };
  const host = {
    allocateTextureUnit: () => {
      assert.ok(nextUnit < 16);
      return nextUnit++;
    },
    setTexture2D: (texture, unit) => {
      uploadCommands++;
      const id = textureId(texture);
      bound.set(unit, id);
      commands.push({ op: "setTexture2D", unit, texture: id });
    },
    setTexture3D: () => {
      throw Error("Unexpected active 3D sampler");
    },
    setTextureCube: () => {
      throw Error("Unexpected active cube sampler");
    },
    setTexture2DArray: () => {
      throw Error("Unexpected active array sampler");
    },
  };
  const Class = guarded ? WebGLUniforms : HistoricalUniforms,
    parsed = new Class(gl, {});
  if (guarded)
    guard.validate(
      parsed.seq,
      values,
      material,
      { id: "actual-native-pair" },
      guard.formats,
      false,
    );
  const seq = Class.seqWithValue(parsed.seq, values);
  if (guarded)
    guard.validate(
      parsed.seq,
      values,
      material,
      { id: "actual-native-pair" },
      guard.formats,
      true,
    );
  Class.upload(gl, seq, values, host);
  const assignments = selected.activeSamplers.map((sampler) => ({
      ...sampler,
      unit: locations.get(sampler.name).unit,
      texture: bound.get(locations.get(sampler.name).unit) ?? null,
      uploaded: seq.some((uniform) => uniform.id === sampler.name),
    })),
    errors = [];
  for (const sampler of assignments) {
    if (!sampler.uploaded)
      errors.push({
        sampler: sampler.name,
        reason: "active-sampler-omitted-by-seqWithValue",
      });
    const texture = textures.find((row) => row.id === sampler.texture);
    if (!texture)
      errors.push({ sampler: sampler.name, reason: "unbound-unit" });
    else if (texture.integer !== (sampler.glType === 36306))
      errors.push({
        sampler: sampler.name,
        reason: "sample-type-disagrees-with-bound-texture",
      });
    for (const other of assignments)
      if (
        other.name !== sampler.name &&
        other.unit === sampler.unit &&
        other.glType !== sampler.glType
      )
        errors.push({
          sampler: sampler.name,
          other: other.name,
          reason: "different-sampler-types-share-unit",
        });
  }
  return {
    label,
    uniformKeys: Object.keys(values),
    uploadedIds: seq.map((uniform) => uniform.id),
    commands,
    assignments,
    errors,
  };
}
// Recreate the previous renderer's exact native semantic keys; resources and
// shader source remain unchanged. No fake shader or substitute texture enters.
const old = { ...material.uniforms },
  renamed = [];
for (const stage of binding.stages)
  for (const resource of stage.sidecar.textures)
    for (const sampler of resource.samplers) {
      if (
        sampler.glslName !== resource.name &&
        Object.hasOwn(material.uniforms, sampler.glslName)
      ) {
        old[resource.name] = material.uniforms[sampler.glslName];
        delete old[sampler.glslName];
        renamed.push({ native: resource.name, glsl: sampler.glslName });
      }
    }
assert.ok(renamed.length > 0);
const before = upload(old, "historical-native-semantic-keys", false),
  after = upload(material.uniforms, "actual-fixed-renderer-keys");
assert.ok(
  before.errors.some(
    (error) => error.reason === "different-sampler-types-share-unit",
  ),
);
assert.equal(after.errors.length, 0);
assert.equal(
  new Set(after.assignments.map((row) => row.unit)).size,
  selected.activeSamplers.length,
);
function rejectBeforeUpload(label, values, pattern) {
  const before = uploadCommands;
  assert.throws(() => upload(values, label), pattern);
  assert.equal(
    uploadCommands,
    before,
    "Rejected sampler contract emits no upload commands",
  );
  guardControls.push({ label, rejectedBeforeUpload: true });
}
rejectBeforeUpload(
  "historical missing GLSL keys",
  old,
  /own sampler data required/,
);
const floatName = selected.activeSamplers.find(
    (sampler) => sampler.glType === 35678,
  ).name,
  uintName = selected.activeSamplers.find(
    (sampler) => sampler.glType === 36306,
  ).name,
  pending = { ...material.uniforms, [floatName]: { value: null } },
  stagedSeq = selected.activeSamplers.map((sampler) => ({
    id: sampler.name,
    type: sampler.glType,
  }));
guard.validate(
  stagedSeq,
  pending,
  material,
  { id: "pending-resource-program" },
  guard.formats,
  false,
);
guardControls.push({
  label: "pending current texture allowed in key-only guard stage",
  accepted: true,
});
rejectBeforeUpload(
  "pending texture rejected at draw",
  pending,
  /current texture required before upload/,
);
rejectBeforeUpload(
  "late missing current texture",
  { ...material.uniforms, [floatName]: { value: null } },
  /current texture required before upload/,
);
rejectBeforeUpload(
  "float sampler bound to uint texture",
  { ...material.uniforms, [floatName]: material.uniforms[uintName] },
  /floating sampler cannot bind integer/,
);
rejectBeforeUpload(
  "uint sampler bound to float texture",
  { ...material.uniforms, [uintName]: material.uniforms[floatName] },
  /unsigned integer texture format required/,
);
rejectBeforeUpload(
  "disabled active upload",
  {
    ...material.uniforms,
    [floatName]: { ...material.uniforms[floatName], needsUpdate: false },
  },
  /upload cannot be disabled/,
);
let invoked = false;
const accessor = {};
Object.defineProperty(accessor, "value", {
  get() {
    invoked = true;
    return material.uniforms[floatName].value;
  },
});
rejectBeforeUpload(
  "accessor uniform record",
  { ...material.uniforms, [floatName]: accessor },
  /own sampler data required/,
);
assert.equal(invoked, false);
guard.validate(
  stagedSeq,
  pending,
  { isRawShaderMaterial: false },
  { id: "ordinary-world-material" },
  guard.formats,
  true,
);
guardControls.push({
  label: "ordinary world material policy unchanged",
  accepted: true,
});
const reopened = upload(
  material.uniforms,
  "resolved-current-resource-accepted",
);
assert.equal(reopened.errors.length, 0);
guardControls.push({
  label: "resolved current texture accepted at draw",
  accepted: true,
});
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final drift ${path}`,
  );
const commandPath = `${cache}/research/direct-three-sampler-upload-commands-v33.json`,
  output = `${cache}/research/direct-three-sampler-upload-v33.json`,
  data = {
    schema: 1,
    kind: "actual-three-static-sampler-unit-command-stream",
    materialKey: fixture.program.materialKey,
    shaderPairSha256: pairSha256,
    shaders: [vertex, pixel],
    textures,
    renamed,
    cases: [before, after],
    scope:
      "Exact owned static material and installed THREE uniform upload; GL host records units/texture identity; separate native GLES replay proves GPU outcome",
  };
await Bun.write(commandPath, JSON.stringify(data, null, 2) + "\n");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-three-static-sampler-upload-control",
      inputs,
      materialKey: fixture.program.materialKey,
      shaderPairSha256: pairSha256,
      executedUniformSourceSha256: await sha256(
        new TextEncoder().encode(uniformSource),
      ),
      executedHistoricalUniformSourceSha256: await sha256(
        new TextEncoder().encode(upstreamUniformSource),
      ),
      executedGuardSourceSha256: await sha256(
        new TextEncoder().encode(guardSource),
      ),
      guardControls,
      commandPath,
      commandSha256: await sha256(await Bun.file(commandPath).bytes()),
      counts: {
        activeSamplers: selected.activeSamplers.length,
        actualTextures: textures.length,
        oldUploaded: before.uploadedIds.length,
        fixedUploaded: after.uploadedIds.length,
        oldErrors: before.errors.length,
        fixedErrors: after.errors.length,
        guardControls: guardControls.length,
      },
      controls: {
        oldKeysReproduceDefaultUnitCollision: true,
        actualOwnedRenderer: true,
        actualVendorParserFilterUploadSetters: true,
        completeFixedSamplerInventory: true,
        distinctFixedUnits: true,
        exactResourceBytes: true,
      },
      scope: {
        strictRecordingHost: true,
        realGL: false,
        gpuPixels: false,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ) + "\n",
);
fixture.renderer.dispose();
console.log(
  JSON.stringify({
    output,
    commandPath,
    materialKey: fixture.program.materialKey,
    beforeErrors: before.errors.length,
    afterErrors: after.errors.length,
    activeSamplers: selected.activeSamplers.length,
  }),
);
