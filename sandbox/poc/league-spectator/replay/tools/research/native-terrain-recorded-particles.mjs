const vertexStride = 28;
const verticesPerQuad = 4;
const indicesPerQuad = 6;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw Error("Unable to allocate recorded particle shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const error = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw Error(`Recorded particle shader failed to compile: ${error}`);
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  if (!program) throw Error("Unable to allocate recorded particle program");
  const shaders = [];
  try {
    shaders.push(createShader(gl, gl.VERTEX_SHADER, vertexSource));
    shaders.push(createShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error(
        `Recorded particle shaders failed to link: ${gl.getProgramInfoLog(program)}`,
      );
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

function saveState(gl, uniformCount, textureCount) {
  const get = (key) => gl.getParameter(key);
  const program = get(gl.CURRENT_PROGRAM);
  const vertexArray = get(gl.VERTEX_ARRAY_BINDING);
  const array = get(gl.ARRAY_BUFFER_BINDING);
  const uniform = get(gl.UNIFORM_BUFFER_BINDING);
  const uniformBindings = Array.from({ length: uniformCount }, (_, index) =>
    gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, index),
  );
  const activeTexture = get(gl.ACTIVE_TEXTURE);
  const textures = Array.from({ length: textureCount }, (_, index) => {
    gl.activeTexture(gl.TEXTURE0 + index);
    return {
      texture: get(gl.TEXTURE_BINDING_2D),
      sampler: get(gl.SAMPLER_BINDING),
    };
  });
  gl.activeTexture(activeTexture);
  const blend = gl.isEnabled(gl.BLEND);
  const cull = gl.isEnabled(gl.CULL_FACE);
  const depth = gl.isEnabled(gl.DEPTH_TEST);
  const depthWrite = get(gl.DEPTH_WRITEMASK);
  const sourceRgb = get(gl.BLEND_SRC_RGB);
  const destRgb = get(gl.BLEND_DST_RGB);
  const sourceAlpha = get(gl.BLEND_SRC_ALPHA);
  const destAlpha = get(gl.BLEND_DST_ALPHA);
  const equationRgb = get(gl.BLEND_EQUATION_RGB);
  const equationAlpha = get(gl.BLEND_EQUATION_ALPHA);
  const toggle = (capability, enabled) =>
    enabled ? gl.enable(capability) : gl.disable(capability);
  return () => {
    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, array);
    for (const [index, buffer] of uniformBindings.entries())
      gl.bindBufferBase(gl.UNIFORM_BUFFER, index, buffer);
    gl.bindBuffer(gl.UNIFORM_BUFFER, uniform);
    for (const [index, { texture, sampler }] of textures.entries()) {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindSampler(index, sampler);
    }
    gl.activeTexture(activeTexture);
    toggle(gl.BLEND, blend);
    toggle(gl.CULL_FACE, cull);
    toggle(gl.DEPTH_TEST, depth);
    gl.depthMask(depthWrite);
    gl.blendFuncSeparate(sourceRgb, destRgb, sourceAlpha, destAlpha);
    gl.blendEquationSeparate(equationRgb, equationAlpha);
  };
}

/**
 * Draw admitted .8428 native quad and world ribbon records using the verified
 * cold remap preview.
 * Texture images remain owned by the caller.
 */
export function createRecordedParticleRenderer(
  gl,
  {
    vertexShader,
    fragmentShader,
    noAlphaTestFragmentShader,
    worldMaskedQuad,
    palettes,
    baseTextures,
  },
) {
  const textureCount = worldMaskedQuad === undefined ? 4 : 5;
  const restore = saveState(gl, 5, textureCount);
  const program = createProgram(gl, vertexShader, fragmentShader);
  const programs = [program];
  let noAlphaTestProgram;
  let maskedProgram;
  const vertexArray = gl.createVertexArray();
  const buffers = [];
  const textures = [];
  function dispose() {
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteVertexArray(vertexArray);
    for (const linkedProgram of programs) gl.deleteProgram(linkedProgram);
  }
  function createBuffer(target) {
    const buffer = gl.createBuffer();
    if (!buffer) throw Error("Unable to allocate recorded particle buffer");
    buffers.push(buffer);
    gl.bindBuffer(target, buffer);
    return buffer;
  }
  function createUniform(index, name, data, targets = programs) {
    const buffer = createBuffer(gl.UNIFORM_BUFFER);
    gl.bufferData(gl.UNIFORM_BUFFER, data, gl.DYNAMIC_DRAW);
    for (const target of targets) {
      const location = gl.getUniformBlockIndex(target, name);
      if (location === gl.INVALID_INDEX)
        throw Error(`Missing recorded particle uniform block: ${name}`);
      gl.uniformBlockBinding(target, location, index);
    }
    return buffer;
  }
  function createTexture(
    image,
    { repeat = false, integer = false, mask } = {},
  ) {
    const texture = gl.createTexture();
    if (!texture) throw Error("Unable to allocate recorded particle texture");
    textures.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = integer ? gl.NEAREST : gl.LINEAR;
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (integer)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32UI,
        1,
        1,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        new Uint32Array(1),
      );
    else if (mask !== undefined) {
      const unpackParameters = [
        [gl.UNPACK_ALIGNMENT, 1],
        [gl.UNPACK_ROW_LENGTH, 0],
        [gl.UNPACK_SKIP_ROWS, 0],
        [gl.UNPACK_SKIP_PIXELS, 0],
        [gl.UNPACK_FLIP_Y_WEBGL, false],
        [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false],
      ].map(([name, value]) => [name, value, gl.getParameter(name)]);
      const unpackBuffer = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
      try {
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        for (const [name, value] of unpackParameters)
          gl.pixelStorei(name, value);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R8,
          mask.width,
          mask.height,
          0,
          gl.RED,
          gl.UNSIGNED_BYTE,
          mask.mask,
        );
      } finally {
        for (const [name, , previous] of unpackParameters)
          gl.pixelStorei(name, previous);
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpackBuffer);
      }
    } else if (image === null)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(4),
      );
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
    return texture;
  }
  try {
    if (!vertexArray)
      throw Error("Unable to allocate recorded particle vertex array");
    if (noAlphaTestFragmentShader !== undefined) {
      noAlphaTestProgram = createProgram(
        gl,
        vertexShader,
        noAlphaTestFragmentShader,
      );
      programs.push(noAlphaTestProgram);
    }
    if (worldMaskedQuad !== undefined) {
      maskedProgram = createProgram(
        gl,
        worldMaskedQuad.vertexShader,
        worldMaskedQuad.fragmentShader,
      );
      programs.push(maskedProgram);
    }
    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);
    const vertexBuffer = createBuffer(gl.ARRAY_BUFFER);
    const indexBuffer = createBuffer(gl.ELEMENT_ARRAY_BUFFER);
    for (const [location, size, type, normalized, offset] of [
      [0, 3, gl.FLOAT, false, 0],
      [1, 4, gl.UNSIGNED_BYTE, true, 12],
      [2, 3, gl.HALF_FLOAT, false, 16],
      [3, 2, gl.HALF_FLOAT, false, 24],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        size,
        type,
        normalized,
        vertexStride,
        offset,
      );
    }
    const cameraBlock = new Float32Array(148);
    if (worldMaskedQuad !== undefined)
      cameraBlock.set(worldMaskedQuad.worldToUv, 88);
    const uniformBuffers = [
      createUniform(
        0,
        "Globals_vs",
        new Float32Array([1, 1, 1, 0, 0, 0, 0, 0]),
      ),
      createUniform(1, "PerFrameVertexCB_vs", cameraBlock),
      // USE_INSTANCE_DRAW = 0 consumes the captured packed vertex layout.
      createUniform(
        2,
        "VFXDynamicPerParticleInstanceCBVS_vs",
        new Uint32Array(16),
      ),
      createUniform(3, "Globals_ps", new Float32Array([5 / 255, 0, 0, 0]), [
        program,
      ]),
      createUniform(4, "PerFramePixelCB_ps", new Uint32Array(132)),
    ];
    // The program without alpha testing stores its sRGB debug flag at the
    // offset occupied by the threshold in the other program.
    const noAlphaTestPrograms = programs.slice(1);
    const noAlphaTestGlobals =
      noAlphaTestPrograms.length === 0
        ? undefined
        : createUniform(
            3,
            "Globals_ps",
            new Uint32Array(4),
            noAlphaTestPrograms,
          );
    for (const linkedProgram of programs) {
      gl.useProgram(linkedProgram);
      for (const [unit, name] of [
        "ParticleQuadInstanceInfo_SharedDataBuffer",
        "TEXTURE_TX",
        "PARTICLE_COLOR_TEXTURE_TX",
        "PIXEL_COLOR_REMAP_RAMP_SharedTexture",
        ...(linkedProgram === maskedProgram
          ? ["NAVMESH_MASK_TEXTURE_SharedTexture"]
          : []),
      ].entries()) {
        const location = gl.getUniformLocation(linkedProgram, name);
        if (location === null)
          throw Error(`Missing recorded particle sampler: ${name}`);
        gl.uniform1i(location, unit);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
    const unusedInstance = createTexture(null, { integer: true });
    const coldRemap = createTexture(null);
    const uploadedPalettes = new Map(
      Array.from(palettes, ([name, image]) => [name, createTexture(image)]),
    );
    const uploaded = new Map(
      Array.from(baseTextures, ([name, image]) => [
        name,
        createTexture(image, { repeat: true }),
      ]),
    );
    const navMask =
      worldMaskedQuad === undefined
        ? undefined
        : createTexture(null, { mask: worldMaskedQuad });
    const worldVertices = new Uint8Array(verticesPerQuad * vertexStride);
    const vertexView = new DataView(worldVertices.buffer);

    function draw(viewProjection, camera, particles) {
      if (particles.length === 0) return;
      const restoreDraw = saveState(gl, uniformBuffers.length, textureCount);
      let restoreRibbon;
      try {
        gl.useProgram(program);
        gl.bindVertexArray(vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        const clip = viewProjection.elements ?? viewProjection;
        for (let row = 0; row < 4; row++)
          for (let column = 0; column < 4; column++) {
            const at = column * 4;
            // The translated shader converts Direct3D clip depth back to GL.
            cameraBlock[row * 4 + column] =
              row === 2 ? (clip[at + 2] + clip[at + 3]) * 0.5 : clip[at + row];
          }
        const { x, y, z } = camera.position;
        cameraBlock.set([x, y, z], 16);
        gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffers[1]);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cameraBlock, 0, 19);
        for (const [index, buffer] of uniformBuffers.entries())
          gl.bindBufferBase(gl.UNIFORM_BUFFER, index, buffer);
        for (const [unit, texture] of [
          [0, unusedInstance],
          [3, coldRemap],
        ]) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.bindSampler(unit, null);
        }
        gl.bindSampler(1, null);
        gl.bindSampler(2, null);
        if (navMask !== undefined) {
          gl.activeTexture(gl.TEXTURE4);
          gl.bindTexture(gl.TEXTURE_2D, navMask);
          gl.bindSampler(4, null);
        }
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        const basis = camera.matrixWorld.elements;
        let activePalette;
        let activeBlend;
        let activeProgram = program;
        let activeDepthTest = true;
        for (const {
          texture,
          palette,
          blend,
          alphaTest,
          depthTest = true,
          centerY,
          position,
          vertices,
          indices,
          worldRibbon,
          worldMaskedQuad: masked,
        } of particles) {
          const particleProgram = masked
            ? maskedProgram
            : alphaTest
              ? program
              : noAlphaTestProgram;
          if (particleProgram === undefined)
            throw Error(
              masked
                ? "The recorded particle needs a masked program"
                : "The recorded particle needs a program without alpha testing",
            );
          if (particleProgram !== activeProgram) {
            gl.useProgram(particleProgram);
            gl.bindBufferBase(
              gl.UNIFORM_BUFFER,
              3,
              alphaTest ? uniformBuffers[3] : noAlphaTestGlobals,
            );
            activeProgram = particleProgram;
          }
          const base = uploaded.get(texture);
          const paletteTexture = uploadedPalettes.get(palette);
          if (!base || !paletteTexture)
            throw Error("Missing recorded particle texture");
          if (masked) {
            restoreRibbon?.();
            restoreRibbon = undefined;
            if (
              worldRibbon ||
              alphaTest ||
              depthTest ||
              blend !== "src-alpha-one" ||
              !(vertices instanceof Uint8Array) ||
              vertices.length === 0 ||
              vertices.length % worldVertices.length !== 0 ||
              !(indices instanceof Uint8Array) ||
              indices.length !==
                (vertices.length / worldVertices.length) * indicesPerQuad * 2
            )
              throw Error("Invalid recorded masked world quad");
          } else if (worldRibbon === true) {
            if (
              !(vertices instanceof Uint8Array) ||
              vertices.length === 0 ||
              vertices.length % vertexStride !== 0 ||
              !(indices instanceof Uint8Array) ||
              indices.length === 0 ||
              indices.length % 6 !== 0 ||
              !alphaTest ||
              !depthTest ||
              blend !== "src-alpha-one"
            )
              throw Error("Invalid recorded world ribbon");
            if (restoreRibbon === undefined) {
              const depthFunc = gl.getParameter(gl.DEPTH_FUNC);
              const offsetEnabled = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
              const offsetFactor = gl.getParameter(gl.POLYGON_OFFSET_FACTOR);
              const offsetUnits = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
              restoreRibbon = () => {
                gl.depthFunc(depthFunc);
                gl.polygonOffset(offsetFactor, offsetUnits);
                if (!offsetEnabled) gl.disable(gl.POLYGON_OFFSET_FILL);
              };
              gl.depthFunc(gl.LEQUAL);
              gl.enable(gl.POLYGON_OFFSET_FILL);
              gl.polygonOffset(-1, -2);
            }
          } else {
            restoreRibbon?.();
            restoreRibbon = undefined;
            if (
              vertices.length !== worldVertices.length ||
              indices.length !== indicesPerQuad * 2
            )
              throw Error("Invalid recorded particle quad");
            worldVertices.set(vertices);
            for (let vertex = 0; vertex < verticesPerQuad; vertex++) {
              const at = vertex * vertexStride;
              const right = vertexView.getFloat32(at, true);
              // Keep the native world-space center while orienting the plane.
              const up = vertexView.getFloat32(at + 4, true) - centerY;
              for (let axis = 0; axis < 3; axis++) {
                const world =
                  position[axis] +
                  (axis === 1 ? centerY : 0) +
                  right * basis[axis] +
                  up * basis[4 + axis];
                vertexView.setFloat32(at + axis * 4, world, true);
              }
            }
          }
          if (paletteTexture !== activePalette) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
            activePalette = paletteTexture;
          }
          if (blend !== activeBlend) {
            gl.blendFunc(
              blend === "src-alpha-one" ? gl.SRC_ALPHA : gl.ONE,
              gl.ONE,
            );
            activeBlend = blend;
          }
          if (depthTest !== activeDepthTest) {
            if (depthTest) gl.enable(gl.DEPTH_TEST);
            else gl.disable(gl.DEPTH_TEST);
            activeDepthTest = depthTest;
          }
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, base);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            masked || worldRibbon === true ? vertices : worldVertices,
            gl.STREAM_DRAW,
          );
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STREAM_DRAW);
          const offsetEnabled = masked && gl.isEnabled(gl.POLYGON_OFFSET_FILL);
          if (offsetEnabled) gl.disable(gl.POLYGON_OFFSET_FILL);
          try {
            gl.drawElements(
              gl.TRIANGLES,
              indices.length / 2,
              gl.UNSIGNED_SHORT,
              0,
            );
          } finally {
            if (offsetEnabled) gl.enable(gl.POLYGON_OFFSET_FILL);
          }
        }
      } finally {
        restoreRibbon?.();
        restoreDraw();
      }
    }
    return { draw, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    restore();
  }
}
