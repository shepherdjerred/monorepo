// Execute the installed THREE buffer-submission and info implementations.
// Shader selection, binding state and GL drawArrays remain explicit supplied
// controls. This catches traversal/range suppression, but is not WebGL evidence.
export function createThreeBufferSubmissionControl(
  source,
  { onDraw = () => {} } = {},
) {
  function section(start, end) {
    const at = source.indexOf(start);
    if (at < 0 || source.indexOf(start, at + 1) !== -1)
      throw Error("Unique installed THREE source boundary required");
    const to = source.indexOf(end, at + start.length);
    if (to < 0) throw Error("Installed THREE source terminator required");
    return source.slice(at, to);
  }
  const infoSource = section(
      "function WebGLInfo( gl ) {",
      "\nfunction WebGLMorphtargets(",
    ),
    bufferSource = section(
      "function WebGLBufferRenderer( gl, extensions, info ) {",
      "\nfunction WebGLCapabilities(",
    ),
    directSource = section(
      "this.renderBufferDirect = function ( camera, scene, geometry, material, object, group ) {",
      "\n\t\t// Compile",
    );
  const draws = [],
    gl = {
      TRIANGLES: 4,
      LINES: 1,
      LINE_LOOP: 2,
      LINE_STRIP: 3,
      POINTS: 0,
      drawArrays(mode, start, count) {
        const draw = { mode, start, count };
        draws.push(draw);
        onDraw(draw);
      },
    },
    fail = () => {
      throw Error("Unexpected supplied THREE buffer-control dependency");
    },
    extensions = { get: fail },
    info = new (new Function("error", `${infoSource}; return WebGLInfo;`)(
      fail,
    ))(gl),
    bufferRenderer = new (new Function(
      `${bufferSource}; return WebGLBufferRenderer;`,
    )())(gl, extensions, info),
    owner = {};
  new Function(
    "_emptyScene",
    "setProgram",
    "state",
    "geometries",
    "bindingStates",
    "bufferRenderer",
    "indexedBufferRenderer",
    "attributes",
    "_gl",
    "getTargetPixelRatio",
    "extensions",
    "properties",
    `${directSource}`,
  ).call(
    owner,
    {},
    () => ({}),
    { setMaterial() {}, setLineWidth: fail },
    { getWireframeAttribute: fail },
    { setup() {} },
    bufferRenderer,
    {},
    { get: fail },
    gl,
    () => 1,
    extensions,
    { get: fail },
  );
  return {
    info,
    draws,
    source: { info: infoSource, buffer: bufferSource, direct: directSource },
    render(scene, camera) {
      if (info.autoReset) info.reset();
      for (const object of scene.children) {
        if (!object.visible) continue;
        owner.renderBufferDirect(
          camera,
          scene,
          object.geometry,
          object.material,
          object,
          null,
        );
      }
    },
    renderBufferDirect: owner.renderBufferDirect,
  };
}
