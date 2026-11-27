const maxSkinJoints = 256;

const vertexSource = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 2) in vec2 uv;
layout(location = 3) in uvec4 jointIndices;
layout(location = 4) in vec4 jointWeights;
uniform mat4 viewProjection;
uniform vec3 actorOrigin;
uniform float actorScale;
uniform mat3 actorBasis;
uniform bool animated;
uniform highp sampler2D jointPalette;
out vec2 surfaceUv;
mat4 skinMatrix(uint joint) {
  int row = int(joint);
  return mat4(
    texelFetch(jointPalette, ivec2(0, row), 0),
    texelFetch(jointPalette, ivec2(1, row), 0),
    texelFetch(jointPalette, ivec2(2, row), 0),
    texelFetch(jointPalette, ivec2(3, row), 0)
  );
}
void main() {
  surfaceUv = uv;
  vec4 localPosition = vec4(position, 1.0);
  if (animated) {
    mat4 skin = jointWeights.x * skinMatrix(jointIndices.x)
              + jointWeights.y * skinMatrix(jointIndices.y)
              + jointWeights.z * skinMatrix(jointIndices.z)
              + jointWeights.w * skinMatrix(jointIndices.w);
    localPosition = skin * localPosition;
  }
  gl_Position = viewProjection * vec4(actorOrigin + actorBasis * localPosition.xyz * actorScale, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 surfaceUv;
uniform sampler2D diffuse;
uniform float alphaCutoff;
out vec4 color;
void main() {
  vec4 texel = texture(diffuse, surfaceUv);
  if (texel.a < alphaCutoff) discard;
  color = vec4(texel.rgb, 1.0);
}`;

export function readOrdinalChampionGlb(bytes) {
  const view = new DataView(bytes);
  const u32 = (offset) => view.getUint32(offset, true);
  if (
    bytes.byteLength < 28 ||
    u32(0) !== 0x46546c67 ||
    u32(4) !== 2 ||
    u32(8) !== bytes.byteLength ||
    u32(16) !== 0x4e4f534a
  )
    throw Error("Invalid ordinal model GLB header");
  const endJson = 20 + u32(12);
  const startBin = endJson + 8;
  if (
    startBin > bytes.byteLength ||
    u32(endJson + 4) !== 0x004e4942 ||
    startBin + u32(endJson) !== bytes.byteLength
  )
    throw Error("Invalid ordinal model GLB binary chunk");
  const gltf = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, endJson - 20)),
  );
  const rootNodes = gltf.scenes?.[gltf.scene ?? 0]?.nodes;
  const mesh = gltf.nodes?.[rootNodes?.[0]];
  if (
    gltf.asset?.version !== "2.0" ||
    rootNodes?.length !== 1 ||
    mesh?.name !== "skinned_mesh" ||
    mesh.mesh !== 0 ||
    mesh.matrix !== undefined ||
    mesh.translation !== undefined ||
    mesh.rotation !== undefined ||
    mesh.scale !== undefined ||
    gltf.meshes?.length !== 1 ||
    gltf.buffers?.length !== 1 ||
    gltf.buffers[0].uri !== undefined ||
    gltf.buffers[0].byteLength > u32(endJson)
  )
    throw Error("Unsupported ordinal model scene");
  return {
    gltf,
    binary: new Uint8Array(bytes, startBin, gltf.buffers[0].byteLength),
  };
}

function bufferView(gltf, binary, index) {
  const view = gltf.bufferViews?.[index];
  const offset = view?.byteOffset ?? 0;
  if (
    view?.buffer !== 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(view.byteLength) ||
    view.byteLength <= 0 ||
    offset + view.byteLength > binary.byteLength
  )
    throw Error("Invalid ordinal model buffer view");
  return binary.subarray(offset, offset + view.byteLength);
}

export function readOrdinalAccessor(
  gltf,
  binary,
  index,
  type,
  componentSizes,
  components,
) {
  const entry = gltf.accessors?.[index];
  const componentSize = componentSizes[entry?.componentType];
  if (
    entry?.type !== type ||
    componentSize === undefined ||
    entry.sparse !== undefined ||
    entry.normalized === true ||
    !Number.isSafeInteger(entry.count) ||
    entry.count < 1
  )
    throw Error(`Invalid ordinal model ${type} accessor`);
  const data = bufferView(gltf, binary, entry.bufferView);
  const offset = entry.byteOffset ?? 0;
  const elementSize = componentSize * components;
  const stride = gltf.bufferViews[entry.bufferView].byteStride ?? elementSize;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset % componentSize !== 0 ||
    !Number.isSafeInteger(stride) ||
    stride < elementSize ||
    stride > 252 ||
    stride % componentSize !== 0 ||
    (type === "SCALAR" && stride !== elementSize) ||
    offset + (entry.count - 1) * stride + elementSize > data.byteLength
  )
    throw Error(`Invalid ordinal model ${type} accessor layout`);
  return {
    data,
    type: entry.componentType,
    count: entry.count,
    offset,
    stride,
  };
}

function prepareGlb(
  bytes,
  { participantId, skinScale, hiddenRanges, inactiveModelRange },
) {
  const { gltf, binary } = readOrdinalChampionGlb(bytes);
  const meshNode = gltf.nodes[gltf.scenes[gltf.scene ?? 0].nodes[0]];
  const skin = gltf.skins?.[meshNode.skin];
  const paletteSize = skin?.joints?.length ?? 0;
  if (
    meshNode.skin !== undefined &&
    (!Number.isSafeInteger(paletteSize) ||
      paletteSize < 1 ||
      paletteSize > maxSkinJoints)
  )
    throw Error(`Invalid ordinal skin palette for champion ${participantId}`);
  const hide = new Set(hiddenRanges.map((name) => name.toLowerCase()));
  if (
    inactiveModelRange !== undefined &&
    (inactiveModelRange !== "Destroyed" || !hide.has("destroyed"))
  )
    throw Error(
      "Inactive model range must be an authored hidden Destroyed range",
    );
  const hidden = new Set();
  const textures = new Map();
  const primitives = [];
  let topY = -Infinity;
  for (const primitive of gltf.meshes[0].primitives) {
    const material = gltf.materials?.[primitive.material];
    if (!material?.name)
      throw Error(`Missing ordinal material for champion ${participantId}`);
    const name = material.name.toLowerCase();
    const inactive = inactiveModelRange !== undefined && name === "destroyed";
    if (hide.has(name)) {
      hidden.add(name);
      if (!inactive) continue;
    }
    const textureInfo = material.pbrMetallicRoughness?.baseColorTexture;
    const texture = gltf.textures?.[textureInfo?.index];
    const image = gltf.images?.[texture?.source];
    const alphaMode = material.alphaMode ?? "OPAQUE";
    if (
      (primitive.mode ?? 4) !== 4 ||
      (textureInfo?.texCoord ?? 0) !== 0 ||
      image?.uri !== undefined ||
      !["image/png", "image/jpeg"].includes(image?.mimeType) ||
      !["OPAQUE", "MASK"].includes(alphaMode)
    )
      throw Error(
        `Unsupported ordinal material ${material.name} for champion ${participantId}`,
      );
    if (!textures.has(texture.source))
      textures.set(
        texture.source,
        new Blob([bufferView(gltf, binary, image.bufferView)], {
          type: image.mimeType,
        }),
      );
    const positions = readOrdinalAccessor(
      gltf,
      binary,
      primitive.attributes.POSITION,
      "VEC3",
      { 5126: 4 },
      3,
    );
    if (!inactive) {
      const vertexBytes = new DataView(
        positions.data.buffer,
        positions.data.byteOffset,
        positions.data.byteLength,
      );
      for (
        let vertex = 0, offset = positions.offset + 4;
        vertex < positions.count;
        vertex++, offset += positions.stride
      ) {
        topY = Math.max(topY, vertexBytes.getFloat32(offset, true));
      }
    }
    const uv = readOrdinalAccessor(
      gltf,
      binary,
      primitive.attributes.TEXCOORD_0,
      "VEC2",
      { 5126: 4 },
      2,
    );
    const indices = readOrdinalAccessor(
      gltf,
      binary,
      primitive.indices,
      "SCALAR",
      { 5123: 2, 5125: 4 },
      1,
    );
    const joints =
      skin &&
      readOrdinalAccessor(
        gltf,
        binary,
        primitive.attributes.JOINTS_0,
        "VEC4",
        { 5121: 1, 5123: 2 },
        4,
      );
    const weights =
      skin &&
      readOrdinalAccessor(
        gltf,
        binary,
        primitive.attributes.WEIGHTS_0,
        "VEC4",
        { 5126: 4 },
        4,
      );
    if (
      [uv, joints, weights].some(
        (attribute) => attribute && attribute.count !== positions.count,
      ) ||
      indices.count % 3 !== 0
    )
      throw Error(`Invalid ordinal triangles for champion ${participantId}`);
    primitives.push({
      inactive,
      positions,
      uv,
      indices,
      joints,
      weights,
      image: texture.source,
      alphaCutoff: alphaMode === "MASK" ? (material.alphaCutoff ?? 0.5) : 0,
    });
  }
  if (
    primitives.length === 0 ||
    hide.size !== hidden.size ||
    (inactiveModelRange !== undefined &&
      !primitives.some(({ inactive }) => inactive)) ||
    !Number.isFinite(topY)
  )
    throw Error(
      `Incomplete ordinal material ranges for champion ${participantId}`,
    );
  return {
    skinScale,
    paletteSize,
    primitives,
    textures,
    topY: topY * skinScale,
  };
}

export function closeChampionModelImages(models) {
  for (const { textures } of models?.values() ?? [])
    for (const bitmap of textures.values()) bitmap.close();
}

async function readChampionModel(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error(`Champion model HTTP ${response.status}`);
  return response.arrayBuffer();
}

export async function loadChampionModels(
  bindings,
  signal,
  read = readChampionModel,
) {
  if (!Array.isArray(bindings) || bindings.length === 0)
    throw Error("Champion model bindings are required");
  const ids = new Set();
  for (const { participantId, skinScale, url } of bindings) {
    if (
      !Number.isSafeInteger(participantId) ||
      ids.has(participantId) ||
      !Number.isFinite(skinScale) ||
      skinScale <= 0 ||
      typeof url !== "string"
    )
      throw Error("Invalid champion model binding");
    ids.add(participantId);
  }
  const models = new Map();
  const jobs = await Promise.allSettled(
    bindings.map(async (binding) => {
      const { textures, ...model } = prepareGlb(
        await read(binding.url, signal),
        binding,
      );
      const images = new Map();
      models.set(binding.participantId, { ...model, textures: images });
      for (const [index, blob] of textures) {
        signal?.throwIfAborted();
        images.set(
          index,
          await createImageBitmap(blob, {
            colorSpaceConversion: "none",
            premultiplyAlpha: "none",
          }),
        );
      }
      signal?.throwIfAborted();
    }),
  );
  const failed = jobs.find(({ status }) => status === "rejected");
  if (failed !== undefined) {
    closeChampionModelImages(models);
    throw failed.reason;
  }
  return models;
}

export function createChampionModelRenderer(gl, models, createProgram) {
  const program = createProgram(gl, vertexSource, fragmentSource);
  const viewProjection = gl.getUniformLocation(program, "viewProjection");
  const actorOrigin = gl.getUniformLocation(program, "actorOrigin");
  const actorScale = gl.getUniformLocation(program, "actorScale");
  const actorBasis = gl.getUniformLocation(program, "actorBasis");
  const identity = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const animated = gl.getUniformLocation(program, "animated");
  const jointPalette = gl.getUniformLocation(program, "jointPalette");
  const alphaCutoff = gl.getUniformLocation(program, "alphaCutoff");
  const buffers = [];
  const arrays = [];
  const textures = [];
  const actors = new Map();

  function uploadBuffer(target, data) {
    const buffer = gl.createBuffer();
    if (buffer === null) throw Error("Could not allocate champion geometry");
    buffers.push(buffer);
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
  }

  function dispose() {
    gl.bindVertexArray(null);
    for (const array of arrays) gl.deleteVertexArray(array);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteProgram(program);
  }

  const paletteTexture = gl.createTexture();
  try {
    if (paletteTexture === null)
      throw Error("Could not allocate champion skin palette");
    textures.push(paletteTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 4, maxSkinJoints);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    for (const [
      id,
      { skinScale, paletteSize, primitives, textures: source },
    ] of models) {
      const uploaded = new Map();
      for (const [image, bitmap] of source) {
        const texture = gl.createTexture();
        if (texture === null)
          throw Error("Could not allocate champion texture");
        textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bitmap,
        );
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          gl.LINEAR_MIPMAP_LINEAR,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.generateMipmap(gl.TEXTURE_2D);
        uploaded.set(image, texture);
      }
      const parts = [];
      const inactiveParts = [];
      const attributesUploaded = new Map();
      for (const {
        inactive = false,
        positions,
        uv,
        indices,
        joints,
        weights,
        image,
        alphaCutoff,
      } of primitives) {
        const array = gl.createVertexArray();
        if (array === null)
          throw Error("Could not allocate champion vertex array");
        arrays.push(array);
        gl.bindVertexArray(array);
        for (const [location, size, attribute] of [
          [0, 3, positions],
          [2, 2, uv],
          [3, 4, joints],
          [4, 4, weights],
        ]) {
          if (attribute === undefined) continue;
          const key = `${attribute.data.byteOffset}:${attribute.data.byteLength}`;
          if (!attributesUploaded.has(key)) {
            uploadBuffer(gl.ARRAY_BUFFER, attribute.data);
            attributesUploaded.set(key, buffers.at(-1));
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, attributesUploaded.get(key));
          gl.enableVertexAttribArray(location);
          if (location === 3)
            gl.vertexAttribIPointer(
              location,
              size,
              attribute.type,
              attribute.stride,
              attribute.offset,
            );
          else
            gl.vertexAttribPointer(
              location,
              size,
              gl.FLOAT,
              false,
              attribute.stride,
              attribute.offset,
            );
        }
        uploadBuffer(gl.ELEMENT_ARRAY_BUFFER, indices.data);
        (inactive ? inactiveParts : parts).push({
          array,
          indexCount: indices.count,
          indexType: indices.type,
          indexOffset: indices.offset,
          texture: uploaded.get(image),
          alphaCutoff,
        });
      }
      if (gl.getError() !== gl.NO_ERROR)
        throw Error(`Could not upload champion model ${id}`);
      actors.set(id, { skinScale, paletteSize, parts, inactiveParts });
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    draw(matrix, markers, animationPalettes) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(jointPalette, 1);
      gl.uniformMatrix4fv(viewProjection, false, matrix);
      for (const {
        participantId,
        position,
        basis = identity,
        inactive = false,
      } of markers) {
        const actor = actors.get(participantId);
        if (
          !actor ||
          position.length !== 3 ||
          !position.every(Number.isFinite) ||
          basis.length !== 9 ||
          !basis.every(Number.isFinite)
        )
          throw Error(
            `Invalid champion model placement for participant ${participantId}`,
          );
        gl.uniform3fv(actorOrigin, position);
        gl.uniform1f(actorScale, actor.skinScale);
        gl.uniformMatrix3fv(actorBasis, false, basis);
        const palette = animationPalettes?.get(participantId);
        gl.uniform1i(animated, palette === undefined ? 0 : 1);
        if (palette !== undefined) {
          if (
            !actor.paletteSize ||
            !(palette instanceof Float32Array) ||
            palette.length !== actor.paletteSize * 16 ||
            !palette.every(Number.isFinite)
          )
            throw Error(
              `Invalid animation palette for participant ${participantId}`,
            );
          gl.activeTexture(gl.TEXTURE1);
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            4,
            actor.paletteSize,
            gl.RGBA,
            gl.FLOAT,
            palette,
          );
          gl.activeTexture(gl.TEXTURE0);
        }
        for (const {
          array,
          indexCount,
          indexType,
          indexOffset,
          texture,
          alphaCutoff: cutoff,
        } of inactive ? actor.inactiveParts : actor.parts) {
          gl.bindVertexArray(array);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.uniform1f(alphaCutoff, cutoff);
          gl.drawElements(gl.TRIANGLES, indexCount, indexType, indexOffset);
        }
      }
    },
    dispose,
  };
}
