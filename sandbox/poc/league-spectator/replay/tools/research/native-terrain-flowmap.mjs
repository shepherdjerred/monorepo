import {
  mayhemFlowMapAsset,
  mayhemFlowMapControlSha256,
} from "./mayhem-flowmap-control-contract.mjs";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// These comparison settings are not observations of native renderer globals.
const controlledGlobals = {
  NORMAL_TANGENT_SCALE_BIAS: [1, 0, 0, 0],
  DEBUG_RENDERTARGET_IS_SRGB_HANDLED: [0],
  RENDERTARGET_IS_SRGB: [0],
  ENV_FOG_COLOR: [0, 0, 0],
  ENV_FOG_ALT_COLOR: [0, 0, 0],
  ENV_FOG_START_END_SCALE_EMISSIVE_REMAP: [-1000, -2000, 0, 2],
  SHADOW_COLOR: [0, 0, 0],
  SHADOW_COLOR_COMPLEMENT: [1, 1, 1],
};
const samplerSource = {
  Flow_Map__TX: "Flow_Map",
  Flowing_Normal_Map__TX: "Flowing_Normal_Map",
  Diffuse_Texture__TX: "Diffuse_Texture",
};

const decodeJson = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

async function digest(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function loadFlowMapControl(read) {
  const prefix = "/flowmap-control/";
  const manifestBytes = await read(prefix + "manifest.json");
  if ((await digest(manifestBytes)) !== mayhemFlowMapControlSha256)
    throw Error("Bloom FlowMap comparison manifest differs from its pin");
  const manifest = decodeJson(manifestBytes);
  async function readAsset(file) {
    const record = manifest.contents[file];
    if (!mayhemFlowMapAsset.test(file) || record === undefined)
      throw Error("Undeclared FlowMap asset " + file);
    const bytes = await read(prefix + file);
    if (
      bytes.byteLength !== record.bytes ||
      (await digest(bytes)) !== record.sha256
    )
      throw Error(
        "Bloom FlowMap comparison asset differs from its pin: " + file,
      );
    return bytes;
  }
  const [meshBytes, geometry, stages] = await Promise.all([
    readAsset("geometry.bin"),
    readAsset("geometry.json").then(decodeJson),
    Promise.all(
      Object.entries(manifest.shaders).map(async ([id, { file }]) => [
        id,
        decodeJson(await readAsset(file)),
      ]),
    ),
  ]);
  const images = new Map();
  const results = await Promise.allSettled(
    Object.entries(manifest.textures).map(async ([id, { file }]) => {
      const image = await createImageBitmap(
        new Blob([await readAsset(file)], { type: "image/png" }),
        {
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        },
      );
      images.set(id, image);
    }),
  );
  function closeImages() {
    for (const image of images.values()) image.close();
  }
  const failed = results.find((result) => result.status === "rejected");
  if (failed !== undefined) {
    closeImages();
    throw failed.reason;
  }
  return {
    manifest,
    meshBytes,
    geometry,
    shaders: Object.fromEntries(stages),
    images,
    closeImages,
  };
}

function requireObject(value, message) {
  if (value === null) throw Error(message);
  return value;
}

function gpuResources(gl) {
  const releases = [];
  return {
    allocate(create, destroy, message) {
      const value = requireObject(create.call(gl), message);
      releases.push(() => destroy.call(gl, value));
      return value;
    },
    dispose() {
      while (releases.length > 0) releases.pop()();
    },
  };
}

function programPair(gl, resources, vertex, fragment) {
  const program = resources.allocate(
    gl.createProgram,
    gl.deleteProgram,
    "FlowMap program allocation failed",
  );
  for (const [kind, stage] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ]) {
    const shader = requireObject(
      gl.createShader(kind),
      "FlowMap shader allocation failed",
    );
    try {
      gl.shaderSource(shader, stage.glsl);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    } finally {
      gl.deleteShader(shader);
    }
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error(gl.getProgramInfoLog(program));
  const blocks = [...vertex.sidecar.blocks, ...fragment.sidecar.blocks].map(
    (block, index) => {
      const location = gl.getUniformBlockIndex(program, block.glslName);
      if (location === gl.INVALID_INDEX)
        throw Error("Missing FlowMap block " + block.glslName);
      gl.uniformBlockBinding(program, location, index);
      const buffer = resources.allocate(
        gl.createBuffer,
        gl.deleteBuffer,
        "FlowMap buffer allocation failed",
      );
      gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
      gl.bufferData(gl.UNIFORM_BUFFER, block.size, gl.DYNAMIC_DRAW);
      const bytes = new ArrayBuffer(block.size);
      return { ...block, index, buffer, bytes, view: new DataView(bytes) };
    },
  );
  gl.useProgram(program);
  const textures = fragment.sidecar.textures.map(
    ({ name, samplers }, index) => {
      if (samplers.length !== 1)
        throw Error("Expected one original FlowMap sampler per texture");
      const location = requireObject(
        gl.getUniformLocation(program, samplers[0].glslName),
        "Missing FlowMap sampler " + name,
      );
      gl.uniform1i(location, index);
      return { name, index };
    },
  );
  return { program, blocks, textures };
}

function flowProjection(matrix) {
  return Array.from({ length: 16 }, (_, index) => {
    const row = Math.floor(index / 4);
    const column = (index % 4) * 4;
    // The shipped PS uses DX clip Z for depth sampling. HexShade restores GL
    // raster Z inside VS without changing the DX clip interpolant.
    return row === 2
      ? (matrix[column + 2] + matrix[column + 3]) / 2
      : matrix[column + row];
  });
}

function fillBlock(gl, block, values) {
  for (const { name, offset, rows, columns, scalar, used } of block.members) {
    if (!used) continue;
    const value = values[name];
    if (value === undefined || value.length < rows * columns)
      throw Error("Missing FlowMap input " + name);
    for (let index = 0; index < rows * columns; index++) {
      if (!Number.isFinite(value[index]))
        throw Error("Invalid FlowMap input " + name);
      if (scalar === "uint")
        block.view.setUint32(offset + index * 4, value[index], true);
      else if (scalar === "float")
        block.view.setFloat32(offset + index * 4, value[index], true);
      else throw Error("Unsupported FlowMap scalar " + scalar);
    }
  }
  gl.bindBuffer(gl.UNIFORM_BUFFER, block.buffer);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(block.bytes));
  gl.bindBufferBase(gl.UNIFORM_BUFFER, block.index, block.buffer);
}

function texture2d(gl, resources, format, width, height, filter) {
  const texture = resources.allocate(
    gl.createTexture,
    gl.deleteTexture,
    "FlowMap texture allocation failed",
  );
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function target(gl, resources, width, height, secondColor) {
  const framebuffer = resources.allocate(
    gl.createFramebuffer,
    gl.deleteFramebuffer,
    "FlowMap framebuffer allocation failed",
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const color = texture2d(gl, resources, gl.RGBA8, width, height, gl.LINEAR);
  const depth = texture2d(
    gl,
    resources,
    gl.DEPTH_COMPONENT24,
    width,
    height,
    gl.NEAREST,
  );
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    color,
    0,
  );
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    depth,
    0,
  );
  if (secondColor) {
    const auxiliary = texture2d(
      gl,
      resources,
      gl.RGBA8,
      width,
      height,
      gl.NEAREST,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT1,
      gl.TEXTURE_2D,
      auxiliary,
      0,
    );
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    throw Error("Incomplete FlowMap framebuffer");
  return { framebuffer, color, depth };
}

export function createFlowMapRenderer(gl, control) {
  const resources = gpuResources(gl);
  try {
    return createRenderer(gl, control, resources);
  } catch (error) {
    resources.dispose();
    throw error;
  }
}

function createRenderer(gl, control, resources) {
  const programs = new Map(
    ["flow", "diffuseFlow"].map((name) => [
      name,
      programPair(gl, resources, control.shaders.vertex, control.shaders[name]),
    ]),
  );
  const textures = new Map();
  for (const [id, image] of control.images) {
    const texture = texture2d(
      gl,
      resources,
      gl.RGBA8,
      image.width,
      image.height,
      gl.LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    textures.set(id, texture);
  }
  const vertexBuffer = resources.allocate(
    gl.createBuffer,
    gl.deleteBuffer,
    "FlowMap vertex allocation failed",
  );
  const indexBuffer = resources.allocate(
    gl.createBuffer,
    gl.deleteBuffer,
    "FlowMap index allocation failed",
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, control.meshBytes, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, control.meshBytes, gl.STATIC_DRAW);
  const groups = control.geometry.groups.map((group) => {
    const vao = resources.allocate(
      gl.createVertexArray,
      gl.deleteVertexArray,
      "FlowMap vertex layout allocation failed",
    );
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    for (const [index, count, offset] of [
      [0, 3, 0],
      [1, 3, 12],
      [2, 2, 24],
    ]) {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(
        index,
        count,
        gl.FLOAT,
        false,
        32,
        group.vertexOffset + offset,
      );
    }
    return { ...group, vao };
  });
  gl.bindVertexArray(null);
  let sceneTarget;
  let snapshot;
  let targetResources;
  let width = 0;
  let height = 0;
  function begin(nextWidth, nextHeight) {
    if (width !== nextWidth || height !== nextHeight) {
      const nextResources = gpuResources(gl);
      try {
        const nextScene = target(
          gl,
          nextResources,
          nextWidth,
          nextHeight,
          true,
        );
        const nextSnapshot = target(
          gl,
          nextResources,
          nextWidth,
          nextHeight,
          false,
        );
        targetResources?.dispose();
        targetResources = nextResources;
        sceneTarget = nextScene;
        snapshot = nextSnapshot;
        width = nextWidth;
        height = nextHeight;
      } catch (error) {
        nextResources.dispose();
        throw error;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  }
  function drawFlow(viewProjection, timeSeconds) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneTarget.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, snapshot.framebuffer);
    // The original samplers expect top-left framebuffer coordinates.
    gl.blitFramebuffer(
      0,
      0,
      width,
      height,
      0,
      height,
      width,
      0,
      gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const frame = {
      ...controlledGlobals,
      WORLD_MATRIX: identity,
      VIEW_PROJECTION_MATRIX: flowProjection(viewProjection),
      TIME: [timeSeconds, 0, 0, 0],
    };
    for (const group of groups) {
      gl.bindVertexArray(group.vao);
      for (const { material, start, count } of group.submeshes) {
        const input = control.manifest.materials[material];
        const program = programs.get(input.shader);
        gl.useProgram(program.program);
        const values = { ...frame, ...input.parameters };
        for (const block of program.blocks) fillBlock(gl, block, values);
        for (const { name, index } of program.textures) {
          const texture =
            name === "sDepthTexture_SharedTexture"
              ? snapshot.depth
              : name === "SAMPLER_BACK_BUFFER_COPY_SharedTexture"
                ? snapshot.color
                : textures.get(input.samplers[samplerSource[name]]);
          if (!texture) throw Error("Unknown FlowMap texture binding " + name);
          gl.activeTexture(gl.TEXTURE0 + index);
          gl.bindTexture(gl.TEXTURE_2D, texture);
        }
        gl.drawElements(
          gl.TRIANGLES,
          count,
          gl.UNSIGNED_INT,
          group.indexOffset + start * 4,
        );
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.activeTexture(gl.TEXTURE0);
  }
  function present() {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneTarget.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      width,
      height,
      0,
      0,
      width,
      height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function dispose() {
    targetResources?.dispose();
    resources.dispose();
  }
  return { begin, drawFlow, present, dispose };
}
