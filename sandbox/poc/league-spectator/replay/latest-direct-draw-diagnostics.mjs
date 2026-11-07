// Explicit capture diagnostics only. Copy every byte synchronously at the draw
// boundary; asynchronous hashing must never observe subsequently reused buffers.
const gpuObjectIds = new WeakMap();
let gpuObjectSequence = 0;
const gpuId = (object) => {
  if (object === null) return null;
  if (!gpuObjectIds.has(object)) gpuObjectIds.set(object, ++gpuObjectSequence);
  return gpuObjectIds.get(object);
};
function snapshot(value) {
  if (ArrayBuffer.isView(value))
    return {
      type: Object.getPrototypeOf(value).constructor.name,
      bytes: new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).slice(),
    };
  if (value instanceof ArrayBuffer)
    return { type: "ArrayBuffer", bytes: new Uint8Array(value).slice() };
  if (Array.isArray(value)) return value.map(snapshot);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, snapshot(v)]),
    );
  return value;
}

async function hashed(value) {
  if (value?.bytes instanceof Uint8Array && typeof value.type === "string") {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", value.bytes),
    );
    return {
      type: value.type,
      byteLength: value.bytes.length,
      sha256: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
        "",
      ),
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(hashed));
  if (value && typeof value === "object")
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([k, v]) => [k, await hashed(v)]),
      ),
    );
  return value;
}

function texture(value) {
  if (Array.isArray(value)) return value.map(texture);
  if (!value?.isTexture) return snapshot(value);
  return {
    id: value.id,
    uuid: value.uuid,
    name: value.name,
    version: value.version,
    format: value.format,
    type: value.type,
    internalFormat: value.internalFormat,
    isRenderTargetTexture: value.isRenderTargetTexture === true,
    image: value.image
      ? {
          width: value.image.width,
          height: value.image.height,
          depth: value.image.depth,
        }
      : null,
    wrapS: value.wrapS,
    wrapT: value.wrapT,
    minFilter: value.minFilter,
    magFilter: value.magFilter,
    flipY: value.flipY,
    colorSpace: value.colorSpace,
    matrix: snapshot(new Float64Array(value.matrix?.elements ?? [])),
  };
}

function renderedMesh(mesh, camera) {
  const m = mesh.material,
    g = mesh.geometry;
  const attributes = Object.fromEntries(
    Object.entries(g.attributes).map(([name, a]) => [
      name,
      {
        itemSize: a.itemSize,
        normalized: a.normalized,
        count: a.count,
        offset: a.offset,
        stride: a.data?.stride,
        array: snapshot(
          a.isInterleavedBufferAttribute ? a.data.array : a.array,
        ),
      },
    ]),
  );
  const fields = [
    "transparent",
    "opacity",
    "blending",
    "blendSrc",
    "blendDst",
    "blendEquation",
    "blendSrcAlpha",
    "blendDstAlpha",
    "blendEquationAlpha",
    "depthTest",
    "depthWrite",
    "depthFunc",
    "colorWrite",
    "side",
    "polygonOffset",
    "polygonOffsetFactor",
    "polygonOffsetUnits",
    "alphaTest",
    "premultipliedAlpha",
    "toneMapped",
  ];
  const world = mesh.matrixWorld.elements,
    view = camera.matrixWorldInverse.elements,
    projection = camera.projectionMatrix.elements;
  const p = [world[12], world[13], world[14], 1];
  const multiply = (matrix, vector) =>
    [0, 1, 2, 3].map(
      (r) =>
        matrix[r] * vector[0] +
        matrix[r + 4] * vector[1] +
        matrix[r + 8] * vector[2] +
        matrix[r + 12] * vector[3],
    );
  const clip = multiply(projection, multiply(view, p));
  const sphere = mesh.boundingSphere ?? g.boundingSphere;
  const center = sphere?.center;
  const centerClip = center
    ? multiply(
        projection,
        multiply(view, multiply(world, [center.x, center.y, center.z, 1])),
      )
    : null;
  return {
    meshId: mesh.id,
    materialId: m.id,
    materialName: m.name,
    renderOrder: mesh.renderOrder,
    projectedOriginZ: clip[2] / clip[3],
    sortBoundingSphere: sphere
      ? {
          center: [center.x, center.y, center.z],
          radius: sphere.radius,
          source: mesh.boundingSphere ? "object" : "geometry",
        }
      : null,
    projectedSortCenterZ: centerClip ? centerClip[2] / centerClip[3] : null,
    sortCenterClipZ: centerClip?.[2] ?? null,
    parentId: mesh.parent?.id ?? null,
    matrixWorld: snapshot(new Float64Array(world)),
    modelViewMatrix: snapshot(new Float64Array(mesh.modelViewMatrix.elements)),
    normalMatrix: snapshot(new Float64Array(mesh.normalMatrix.elements)),
    attributes,
    index: snapshot(g.index?.array),
    drawRange: { ...g.drawRange },
    materialState: Object.fromEntries(fields.map((name) => [name, m[name]])),
    uniforms: Object.fromEntries(
      Object.entries(m.uniforms ?? {}).map(([name, u]) => [
        name,
        texture(u.value),
      ]),
    ),
    uniformGroups: (m.uniformsGroups ?? []).map((group) => ({
      name: group.name,
      values: group.uniforms.map((u) => snapshot(u.value)),
    })),
  };
}

function gpuUniformBlocks(gl) {
  if (!gl) return null;
  const program = gl.getParameter(gl.CURRENT_PROGRAM);
  if (!program) throw Error("Captured FX submission has no current GL program");
  const previous = gl.getParameter(gl.COPY_READ_BUFFER_BINDING),
    blocks = [];
  try {
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS);
    for (let index = 0; index < count; index++) {
      const name = gl.getActiveUniformBlockName(program, index),
        binding = gl.getActiveUniformBlockParameter(
          program,
          index,
          gl.UNIFORM_BLOCK_BINDING,
        ),
        requiredBytes = gl.getActiveUniformBlockParameter(
          program,
          index,
          gl.UNIFORM_BLOCK_DATA_SIZE,
        ),
        buffer = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, binding);
      if (!buffer) throw Error(`Captured GL block ${name} is unbound`);
      gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
      const size = gl.getBufferParameter(gl.COPY_READ_BUFFER, gl.BUFFER_SIZE),
        bytes = new Uint8Array(size);
      gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes);
      blocks.push({
        name,
        index,
        binding,
        requiredBytes,
        bufferId: gpuId(buffer),
        bytes: snapshot(bytes),
      });
    }
  } finally {
    gl.bindBuffer(gl.COPY_READ_BUFFER, previous);
  }
  return blocks;
}

function gpuSamplers(webglRenderer, material) {
  if (!webglRenderer) return null;
  const gl = webglRenderer.getContext(),
    program = gl.getParameter(gl.CURRENT_PROGRAM),
    previous = gl.getParameter(gl.ACTIVE_TEXTURE),
    samplers = [];
  const targets = new Map([
    [0x8b5e, [gl.TEXTURE_2D, gl.TEXTURE_BINDING_2D]],
    [0x8dd2, [gl.TEXTURE_2D, gl.TEXTURE_BINDING_2D]],
    [0x8dca, [gl.TEXTURE_2D, gl.TEXTURE_BINDING_2D]],
    [0x8b60, [gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BINDING_CUBE_MAP]],
    [0x8b5f, [gl.TEXTURE_3D, gl.TEXTURE_BINDING_3D]],
    [0x8dc1, [gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BINDING_2D_ARRAY]],
  ]);
  const parameters = [
    gl.TEXTURE_MIN_FILTER,
    gl.TEXTURE_MAG_FILTER,
    gl.TEXTURE_WRAP_S,
    gl.TEXTURE_WRAP_T,
    gl.TEXTURE_WRAP_R,
    gl.TEXTURE_MIN_LOD,
    gl.TEXTURE_MAX_LOD,
    gl.TEXTURE_COMPARE_MODE,
    gl.TEXTURE_COMPARE_FUNC,
  ];
  try {
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < count; index++) {
      const info = gl.getActiveUniform(program, index),
        target = targets.get(info.type);
      if (!target) continue;
      const value = gl.getUniform(
          program,
          gl.getUniformLocation(program, info.name),
        ),
        units = typeof value === "number" ? [value] : Array.from(value),
        supplied =
          material.uniforms?.[info.name]?.value ??
          material.uniforms?.[info.name.replace(/\[0\]$/, "")]?.value;
      const bindings = units.map((unit, lane) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        const boundTexture = gl.getParameter(target[1]),
          sampler = gl.getParameter(gl.SAMPLER_BINDING),
          expected = Array.isArray(supplied) ? supplied[lane] : supplied,
          expectedNative = expected?.isTexture
            ? webglRenderer.properties.get(expected).__webglTexture
            : null;
        return {
          unit,
          target: target[0],
          textureId: gpuId(boundTexture),
          samplerId: gpuId(sampler),
          expectedTextureId: expected?.id ?? null,
          matchesExpectedTexture: expectedNative
            ? expectedNative === boundTexture
            : null,
          parameters: Object.fromEntries(
            parameters.map((name) => [
              name,
              sampler
                ? gl.getSamplerParameter(sampler, name)
                : boundTexture
                  ? gl.getTexParameter(target[0], name)
                  : null,
            ]),
          ),
        };
      });
      samplers.push({
        name: info.name,
        type: info.type,
        size: info.size,
        bindings,
      });
    }
  } finally {
    gl.activeTexture(previous);
  }
  return samplers;
}

function fixedFunctionState(gl) {
  if (!gl?.isEnabled) return null;
  const enabled = [
    "BLEND",
    "DEPTH_TEST",
    "STENCIL_TEST",
    "CULL_FACE",
    "SCISSOR_TEST",
    "POLYGON_OFFSET_FILL",
    "DITHER",
    "SAMPLE_ALPHA_TO_COVERAGE",
    "SAMPLE_COVERAGE",
    "RASTERIZER_DISCARD",
  ];
  const parameters = [
    "BLEND_SRC_RGB",
    "BLEND_DST_RGB",
    "BLEND_SRC_ALPHA",
    "BLEND_DST_ALPHA",
    "BLEND_EQUATION_RGB",
    "BLEND_EQUATION_ALPHA",
    "BLEND_COLOR",
    "DEPTH_FUNC",
    "DEPTH_WRITEMASK",
    "DEPTH_RANGE",
    "DEPTH_CLEAR_VALUE",
    "COLOR_WRITEMASK",
    "COLOR_CLEAR_VALUE",
    "STENCIL_FUNC",
    "STENCIL_REF",
    "STENCIL_VALUE_MASK",
    "STENCIL_WRITEMASK",
    "STENCIL_FAIL",
    "STENCIL_PASS_DEPTH_FAIL",
    "STENCIL_PASS_DEPTH_PASS",
    "STENCIL_BACK_FUNC",
    "STENCIL_BACK_REF",
    "STENCIL_BACK_VALUE_MASK",
    "STENCIL_BACK_WRITEMASK",
    "STENCIL_BACK_FAIL",
    "STENCIL_BACK_PASS_DEPTH_FAIL",
    "STENCIL_BACK_PASS_DEPTH_PASS",
    "STENCIL_CLEAR_VALUE",
    "CULL_FACE_MODE",
    "FRONT_FACE",
    "POLYGON_OFFSET_FACTOR",
    "POLYGON_OFFSET_UNITS",
    "VIEWPORT",
    "SCISSOR_BOX",
    "SAMPLE_COVERAGE_VALUE",
    "SAMPLE_COVERAGE_INVERT",
    "SAMPLES",
  ];
  return {
    enabled: Object.fromEntries(
      enabled.map((name) => [name, gl.isEnabled(gl[name])]),
    ),
    parameters: Object.fromEntries(
      parameters.map((name) => [name, snapshot(gl.getParameter(gl[name]))]),
    ),
    framebufferId: gpuId(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),
  };
}

function gpuGeometry(gl) {
  if (!gl?.getVertexAttrib) return null;
  const program = gl.getParameter(gl.CURRENT_PROGRAM),
    previous = gl.getParameter(gl.COPY_READ_BUFFER_BINDING),
    attributes = [],
    buffers = new Map();
  const read = (buffer) => {
    if (!buffer) return null;
    if (!buffers.has(buffer)) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
      const bytes = new Uint8Array(
        gl.getBufferParameter(gl.COPY_READ_BUFFER, gl.BUFFER_SIZE),
      );
      gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes);
      buffers.set(buffer, { bufferId: gpuId(buffer), bytes: snapshot(bytes) });
    }
    return buffers.get(buffer);
  };
  try {
    const count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let index = 0; index < count; index++) {
      const info = gl.getActiveAttrib(program, index),
        location = gl.getAttribLocation(program, info.name),
        parameters = Object.fromEntries(
          [
            "VERTEX_ATTRIB_ARRAY_ENABLED",
            "VERTEX_ATTRIB_ARRAY_SIZE",
            "VERTEX_ATTRIB_ARRAY_STRIDE",
            "VERTEX_ATTRIB_ARRAY_TYPE",
            "VERTEX_ATTRIB_ARRAY_NORMALIZED",
            "VERTEX_ATTRIB_ARRAY_INTEGER",
            "VERTEX_ATTRIB_ARRAY_DIVISOR",
          ].map((name) => [name, gl.getVertexAttrib(location, gl[name])]),
        );
      attributes.push({
        name: info.name,
        type: info.type,
        size: info.size,
        location,
        parameters,
        offset: gl.getVertexAttribOffset(
          location,
          gl.VERTEX_ATTRIB_ARRAY_POINTER,
        ),
        current: snapshot(
          gl.getVertexAttrib(location, gl.CURRENT_VERTEX_ATTRIB),
        ),
        buffer: read(
          gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
        ),
      });
    }
    return {
      vaoId: gpuId(gl.getParameter(gl.VERTEX_ARRAY_BINDING)),
      attributes,
      index: read(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)),
    };
  } finally {
    gl.bindBuffer(gl.COPY_READ_BUFFER, previous);
  }
}

function skinningInputs(mesh) {
  if (!mesh.isSkinnedMesh) return null;
  const skeleton = mesh.skeleton,
    texture = skeleton.boneTexture;
  return {
    meshId: mesh.id,
    name: mesh.name,
    materialName: mesh.material?.name ?? null,
    boneMatrices: snapshot(skeleton.boneMatrices),
    boneWorldMatrices: snapshot(
      new Float64Array(
        skeleton.bones.flatMap((bone) => bone.matrixWorld.elements),
      ),
    ),
    bindMatrix: snapshot(new Float64Array(mesh.bindMatrix.elements)),
    bindMatrixInverse: snapshot(
      new Float64Array(mesh.bindMatrixInverse.elements),
    ),
    worldMatrix: snapshot(new Float64Array(mesh.matrixWorld.elements)),
    boneTexture: texture
      ? {
          id: texture.id,
          version: texture.version,
          width: texture.image.width,
          height: texture.image.height,
          bytes: snapshot(texture.image.data),
        }
      : null,
  };
}

function worldSubmission(mesh, camera, material) {
  const matrix = mesh.matrixWorld.clone(),
    center =
      mesh.boundingSphere?.center ?? mesh.geometry?.boundingSphere?.center;
  const worldPosition = center
    ? center.clone().applyMatrix4(matrix)
    : mesh.position.clone().setFromMatrixPosition(matrix);
  // Match the vendor's Vector4 clip-z (no perspective divide).
  const view = camera.matrixWorldInverse.elements,
    p = [worldPosition.x, worldPosition.y, worldPosition.z, 1];
  const v = [0, 1, 2, 3].map(
    (r) =>
      view[r] * p[0] + view[r + 4] * p[1] + view[r + 8] * p[2] + view[r + 12],
  );
  const projection = camera.projectionMatrix.elements;
  let groupOrder = 0;
  for (let node = mesh.parent; node; node = node.parent)
    if (node.isGroup) {
      groupOrder = node.renderOrder;
      break;
    }
  return {
    meshId: mesh.id,
    name: mesh.name,
    type: mesh.type,
    materialId: material?.id ?? null,
    materialName: material?.name ?? null,
    transparent: material?.transparent ?? null,
    renderOrder: mesh.renderOrder,
    groupOrder,
    sortCenterClipZ:
      projection[2] * v[0] +
      projection[6] * v[1] +
      projection[10] * v[2] +
      projection[14] * v[3],
  };
}

export function beginDirectDrawCapture(
  packet,
  renderer,
  camera,
  { webglRenderer = null, scene = null } = {},
) {
  const packetDraws = snapshot(packet.draws),
    submissions = [],
    worldSubmissions = [],
    worldSkinningInitial = [],
    clearCalls = [],
    restorations = [];
  const owners = [
    ["conventional", renderer.directMeshes],
    ["navigation", renderer.navGroundRenderer?.meshes],
    ["ray", renderer.rayRenderer?.meshes],
    ["static-mesh", renderer.staticMeshRenderer?.meshes],
  ];
  const seen = new Map();
  let gpuReadbackCpuMs = 0,
    navOutput = null;
  const gl = webglRenderer?.getContext();
  if (gl?.clear) {
    const previousClear = gl.clear,
      descriptor = Object.getOwnPropertyDescriptor(gl, "clear");
    gl.clear = function (mask) {
      clearCalls.push({
        mask,
        afterWorldSubmissionCount: worldSubmissions.length,
        state: fixedFunctionState(gl),
      });
      return previousClear.call(this, mask);
    };
    restorations.push(() => {
      if (descriptor) Object.defineProperty(gl, "clear", descriptor);
      else delete gl.clear;
    });
  }
  const observe = (mesh, owner, key) => {
    const registered = seen.get(mesh);
    if (registered) {
      if (registered.owner !== "world")
        throw Error("Duplicate diagnostic mesh ownership");
      Object.assign(registered, { owner, key });
      return;
    }
    const identity = { owner, key };
    seen.set(mesh, identity);
    const previous = mesh.onAfterRender;
    mesh.onAfterRender = function (...args) {
      previous?.apply(this, args);
      const material = args[4] ?? mesh.material;
      const ordinal = worldSubmissions.length;
      if (scene)
        worldSubmissions.push({
          ordinal,
          ...identity,
          ...worldSubmission(mesh, camera, material),
          skinning: skinningInputs(mesh),
          gpuState: mesh.isSkinnedMesh ? fixedFunctionState(gl) : null,
        });
      if (identity.owner !== "world") {
        const started = performance.now();
        const gpuBlocks = gpuUniformBlocks(webglRenderer?.getContext());
        const samplers = gpuSamplers(webglRenderer, material);
        const geometry = gpuGeometry(gl),
          state = fixedFunctionState(gl);
        gpuReadbackCpuMs += performance.now() - started;
        submissions.push({
          ordinal: submissions.length,
          worldOrdinal: scene ? ordinal : null,
          ...identity,
          ...renderedMesh(mesh, camera),
          gpuUniformBlocks: gpuBlocks,
          gpuSamplers: samplers,
          gpuGeometry: geometry,
          gpuState: state,
        });
      }
    };
    restorations.push(() => {
      mesh.onAfterRender = previous;
    });
  };
  scene?.traverse((node) => {
    if (node.isSkinnedMesh) worldSkinningInitial.push(skinningInputs(node));
    if (node.isMesh || node.isSprite || node.isLine || node.isPoints)
      observe(node, "world", null);
  });
  const attach = () => {
    for (const [owner, meshes] of owners)
      for (const [key, mesh] of meshes ?? []) {
        if (!mesh.visible) continue;
        observe(mesh, owner, key);
      }
  };
  // Navigation-backed commits create/replace combat meshes during drawScene's
  // staged submission, immediately before the world render. Observe that exact
  // boundary instead of prematurely examining the previous frame's mesh pool.
  const previousSubmit = renderer.submitStagedDirect;
  if (renderer.pendingCombat) {
    renderer.submitStagedDirect = function (...args) {
      const result = previousSubmit.apply(this, args);
      attach();
      return result;
    };
    restorations.push(() => {
      renderer.submitStagedDirect = previousSubmit;
    });
  } else attach();
  let stopped = false;
  return {
    stop() {
      if (stopped) throw Error("Direct draw capture already stopped");
      stopped = true;
      for (const restore of restorations) restore();
      const target =
        renderer.navigation?.provider?.resources?.targets.get("output");
      if (target && webglRenderer) {
        const started = performance.now(),
          previousTarget = webglRenderer.getRenderTarget(),
          face = webglRenderer.getActiveCubeFace(),
          mip = webglRenderer.getActiveMipmapLevel(),
          bytes = new Uint8Array(target.width * target.height * 4);
        try {
          webglRenderer.readRenderTargetPixels(
            target,
            0,
            0,
            target.width,
            target.height,
            bytes,
          );
          navOutput = {
            width: target.width,
            height: target.height,
            bytes: snapshot(bytes),
          };
        } finally {
          if (webglRenderer.getRenderTarget() !== previousTarget)
            webglRenderer.setRenderTarget(previousTarget, face, mip);
          gpuReadbackCpuMs += performance.now() - started;
        }
      }
    },
    async report() {
      if (!stopped) throw Error("Stop diagnostic draw capture before hashing");
      return hashed({
        policy: "exact-capture-submission-bytes-v3",
        time: packet.time,
        scope:
          "Capture-only synchronous GPU UBO/nav-output readback stalls; CPU packet/submission bytes and lightweight whole-scene order. Other texture pixels are not read back.",
        gpuReadbackCpuMs,
        packetDraws,
        submissions,
        worldSubmissions,
        worldSkinningInitial,
        clearCalls,
        navOutput,
      });
    },
  };
}
