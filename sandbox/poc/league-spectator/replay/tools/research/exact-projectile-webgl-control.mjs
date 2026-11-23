// Private component draw. Source shader identities and native vertex layouts
// are verified by the offline host before this executes.
export async function runExactProjectileWebglControl(input) {
  const side = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  document.body.append(canvas);
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) throw Error("WebGL2 unavailable in the isolated browser");
  const vertexSource = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 position;
    layout(location=1) in vec4 packedColor;
    layout(location=2) in vec4 baseUvFrame;
    layout(location=3) in vec2 paletteUv;
    uniform mat4 viewProjection;
    uniform vec4 fogTransform;
    uniform vec3 atlas;
    out vec4 tint;
    out vec4 uv;
    out vec2 fogUv;
    void main() {
      tint = packedColor.zyxw;
      float frame = floor(baseUvFrame.z);
      float row = floor(frame * atlas.y);
      uv = vec4(vec2(frame - row * atlas.x, row) * atlas.yz + baseUvFrame.xy * atlas.yz, paletteUv);
      fogUv = position.xz * fogTransform.xy + fogTransform.zw;
      // Explicit zero camera pushback for this non-instanced control.
      gl_Position = viewProjection * vec4(position, 1.0);
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    precision highp int;
    uniform sampler2D baseTexture;
    uniform sampler2D paletteTexture;
    uniform sampler2D fogTexture;
    uniform sampler2D remapTexture;
    uniform float alphaCutoff;
    uniform bool renderTargetIsSrgb;
    uniform int debugRenderTarget;
    in vec4 tint;
    in vec4 uv;
    in vec2 fogUv;
    out vec4 color;
    void main() {
      vec4 product = texture(baseTexture, uv.xy) * texture(paletteTexture, uv.zw);
      float alphaTest = tint.a * product.a - alphaCutoff;
      if (alphaTest < 0.0) discard;
      product *= tint;
      float luminance = dot(product.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec4 remap = texture(remapTexture, vec2(luminance, 0.5));
      vec3 rgb = remap.a > 0.0 ? remap.rgb : product.rgb;
      rgb *= texture(fogTexture, fogUv).a;
      if (debugRenderTarget == 1234) rgb = vec3(0.5);
      else if (renderTargetIsSrgb) rgb = pow(rgb, vec3(2.2));
      color = vec4(rgb, product.a);
    }`;
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const uniform = (name) => gl.getUniformLocation(program, name);
  gl.uniformMatrix4fv(uniform("viewProjection"), false, [
    1 / 250,
    0,
    0,
    0,
    0,
    1 / 158,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    30 / 158,
    0,
    1,
  ]);
  gl.uniform3f(uniform("atlas"), 1, 1, 1);
  gl.uniform4f(uniform("fogTransform"), 0, 0, 0.5, 0.5);
  gl.uniform1i(uniform("renderTargetIsSrgb"), 0);
  gl.uniform1i(uniform("debugRenderTarget"), 0);

  const sourceDimensions = {};
  for (const [unit, name, address, supplied] of [
    [0, "baseTexture", gl.REPEAT],
    [1, "paletteTexture", gl.CLAMP_TO_EDGE],
    [2, "fogTexture", gl.CLAMP_TO_EDGE, [0, 0, 0, 255]],
    [3, "remapTexture", gl.CLAMP_TO_EDGE, [0, 0, 0, 0]],
  ]) {
    const bitmap = supplied
      ? null
      : await createImageBitmap(await (await fetch(`/${name}.png`)).blob(), {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, address);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, address);
    if (bitmap) {
      sourceDimensions[name] = [bitmap.width, bitmap.height];
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
      );
      bitmap.close();
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(supplied),
      );
    }
    gl.uniform1i(uniform(name), unit);
  }
  const decode = (hex) =>
    Uint8Array.from(hex.match(/../g), (value) => Number.parseInt(value, 16));
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, decode(input.verticesHex), gl.STATIC_DRAW);
  for (const [index, size, type, normalized, offset] of [
    [0, 3, gl.FLOAT, false, 0],
    [1, 4, gl.UNSIGNED_BYTE, true, 12],
    [2, 4, gl.HALF_FLOAT, false, 16],
    [3, 2, gl.HALF_FLOAT, false, 24],
  ]) {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, type, normalized, 28, offset);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    decode(input.indicesHex),
    gl.STATIC_DRAW,
  );
  gl.enable(gl.BLEND);
  gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
  gl.blendFuncSeparate(
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DITHER);
  gl.frontFace(gl.CW);
  gl.viewport(0, 0, side, side);
  const clear = [20, 25, 40, 255];
  gl.clearColor(...clear.map((value) => value / 255));

  const cases = [];
  let png;
  for (const [name, indexCount, cutoff] of [
    ["preBirth", input.emptyPoolIndices, input.cutoff],
    ["retained", input.retainedIndexCount, input.cutoff],
    ["sameClock", input.retainedIndexCount, input.cutoff],
    ["expired", input.expiredIndexCount, input.cutoff],
    ["rejectAllByAlpha", input.retainedIndexCount, 1],
  ]) {
    gl.uniform1f(uniform("alphaCutoff"), cutoff);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    const pixels = new Uint8Array(side * side * 4);
    gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw Error(`WebGL ${name} error ${error}`);
    let changedPixels = 0;
    let strongest,
      maxDelta = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const delta =
        Math.abs(pixels[i] - clear[0]) +
        Math.abs(pixels[i + 1] - clear[1]) +
        Math.abs(pixels[i + 2] - clear[2]);
      if (delta || pixels[i + 3] !== clear[3]) changedPixels++;
      if (delta > maxDelta) {
        maxDelta = delta;
        const p = i / 4;
        strongest = {
          x: p % side,
          y: Math.floor(p / side),
          rgba: [...pixels.subarray(i, i + 4)],
        };
      }
    }
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    cases.push({ name, indexCount, cutoff, changedPixels, strongest, sha256 });
    if (name === "retained") {
      // readPixels is bottom-up. Export exactly those bytes for inspection.
      const image = new ImageData(side, side);
      for (let y = 0; y < side; y++)
        image.data.set(
          pixels.subarray(y * side * 4, (y + 1) * side * 4),
          (side - 1 - y) * side * 4,
        );
      const proofCanvas = document.createElement("canvas");
      proofCanvas.width = proofCanvas.height = side;
      proofCanvas.getContext("2d").putImageData(image, 0, 0);
      png = proofCanvas.toDataURL("image/png");
    }
  }
  const active = cases.find(({ name }) => name === "retained");
  if (!active.strongest)
    throw Error("The retained particle produced no color contribution");
  const blendState = {
    enabled: gl.isEnabled(gl.BLEND),
    equation: [
      gl.getParameter(gl.BLEND_EQUATION_RGB),
      gl.getParameter(gl.BLEND_EQUATION_ALPHA),
    ],
    source: [
      gl.getParameter(gl.BLEND_SRC_RGB),
      gl.getParameter(gl.BLEND_SRC_ALPHA),
    ],
    destination: [
      gl.getParameter(gl.BLEND_DST_RGB),
      gl.getParameter(gl.BLEND_DST_ALPHA),
    ],
    depthTest: gl.isEnabled(gl.DEPTH_TEST),
    depthWrite: gl.getParameter(gl.DEPTH_WRITEMASK),
  };
  gl.disable(gl.BLEND);
  gl.uniform1f(uniform("alphaCutoff"), input.cutoff);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, input.retainedIndexCount, gl.UNSIGNED_SHORT, 0);
  const source = new Uint8Array(4);
  gl.readPixels(
    active.strongest.x,
    active.strongest.y,
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    source,
  );
  if (gl.getError() !== gl.NO_ERROR)
    throw Error("WebGL source-color diagnostic failed");
  const alpha = source[3] / 255;
  const expected = [...source].map((value, index) =>
    Math.round(value * alpha + clear[index] * (1 - alpha)),
  );
  return {
    version: gl.getParameter(gl.VERSION),
    renderer: gl.getParameter(gl.RENDERER),
    sourceDimensions,
    framebufferSize: [side, side],
    clear,
    cases,
    blendState,
    blendReadback: {
      source: [...source],
      expected,
      actual: active.strongest.rgba,
    },
    png,
  };
}
