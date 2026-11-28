import { PerspectiveCamera, Vector3 } from "/three.core.js";
import { createChampionModelRenderer } from "./native-terrain-actors.mjs";
import { createRecordedParticleRenderer } from "./native-terrain-recorded-particles.mjs";
import {
  createChampionOverhead,
  projectChampionTop,
} from "./native-terrain-overhead.mjs";

export {
  closeChampionModelImages,
  loadChampionModels,
} from "./native-terrain-actors.mjs";

const terrainClearColor = [0.06, 0.09, 0.11, 1];
const healthTrackColor = [0.06, 0.09, 0.12, 1];
const blueHealthColor = [94 / 255, 173 / 255, 212 / 255, 1];
const redHealthColor = [219 / 255, 94 / 255, 98 / 255, 1];

export function inhibitorIsActive(
  { destroyedAtSeconds, inactiveRanges },
  timeSeconds,
) {
  if (inactiveRanges === undefined)
    return destroyedAtSeconds === null || timeSeconds < destroyedAtSeconds;
  return !inactiveRanges.some(
    ([start, end]) =>
      timeSeconds >= start && (end === null || timeSeconds < end),
  );
}

function drawChampionHealth(
  gl,
  frame,
  sample,
  models,
  matrix,
  width,
  height,
  ratio,
) {
  const gaugeWidth = Math.round(54 * ratio);
  const gaugeHeight = Math.round(6 * ratio);
  const border = Math.round(ratio);
  const screenGap = Math.round(4 * ratio);
  let drawing = false;
  try {
    for (const { participantId, position, teamId } of frame.markers) {
      const model = models.get(participantId);
      if (model === undefined) continue;
      const health = sample(participantId, frame.timeSeconds);
      if (health === undefined) continue;
      const point = projectChampionTop(
        position,
        model.topY,
        matrix,
        width,
        height,
      );
      if (point === undefined) continue;
      const left = Math.round(point[0] - gaugeWidth / 2);
      const bottom = Math.round(point[1]) + screenGap;
      if (
        left < 0 ||
        left + gaugeWidth > width ||
        bottom + gaugeHeight > height
      )
        continue;
      if (!drawing) {
        gl.enable(gl.SCISSOR_TEST);
        drawing = true;
      }
      gl.scissor(left, bottom, gaugeWidth, gaugeHeight);
      gl.clearColor(...healthTrackColor);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const [, current, max] = health;
      if (current === 0) continue;
      const filled = Math.max(
        1,
        Math.round(((gaugeWidth - 2 * border) * current) / max),
      );
      gl.scissor(
        left + border,
        bottom + border,
        filled,
        gaugeHeight - 2 * border,
      );
      gl.clearColor(...(teamId === 100 ? blueHealthColor : redHealthColor));
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  } finally {
    if (drawing) {
      gl.disable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, width, height);
      gl.clearColor(...terrainClearColor);
    }
  }
}

const vertexSource = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in float team;
layout(location = 2) in vec2 uv;
uniform mat4 viewProjection;
uniform float pointSize;
out vec3 world;
out float markerTeam;
out vec2 surfaceUv;
void main() {
  world = position;
  markerTeam = team;
  surfaceUv = uv;
  gl_Position = viewProjection * vec4(world, 1.0);
  gl_PointSize = pointSize;
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec3 world;
in float markerTeam;
in vec2 surfaceUv;
uniform bool markers;
uniform bool textured;
uniform bool sourceAlphaBlend;
uniform sampler2D diffuse;
uniform float alphaTest;
out vec4 color;
void main() {
  if (markers) {
    vec2 centered = abs(gl_PointCoord - vec2(0.5));
    bool turret = markerTeam == 0.0;
    float radius = turret ? max(centered.x, centered.y) : length(centered);
    if (radius > 0.5) discard;
    vec3 team = turret ? vec3(1.0, 0.86, 0.44) : markerTeam < 150.0 ? vec3(0.31, 0.82, 1.0) : vec3(1.0, 0.57, 0.24);
    color = vec4(radius > 0.36 ? vec3(0.09, 0.12, 0.15) : team, 1.0);
    return;
  }
  if (textured) {
    vec4 texel = texture(diffuse, surfaceUv);
    if (texel.a < alphaTest) discard;
    color = vec4(texel.rgb, sourceAlphaBlend ? texel.a : 1.0);
    return;
  }
  vec3 normal = normalize(cross(dFdx(world), dFdy(world)));
  float slope = abs(normal.y);
  float light = abs(dot(normal, normalize(vec3(-0.6, 1.0, -0.4))));
  float elevation = smoothstep(-90.0, 380.0, world.y);
  vec3 stone = mix(vec3(0.19, 0.31, 0.34), vec3(0.63, 0.67, 0.58), elevation);
  color = vec4(stone * (0.65 + 0.22 * slope + 0.25 * light), 1.0);
}`;

function createProgram(gl, vertex = vertexSource, fragment = fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error(gl.getProgramInfoLog(program));
  return program;
}

function terrainArrays(metadata, bytes, expected, bindings, visibilityTracks) {
  const { meshes, sourceMeshCount } = metadata;
  if (
    meshes.length !== expected.exportedMeshes ||
    sourceMeshCount !== expected.sourceMeshCount
  )
    throw Error("Map11 export mesh totals do not match the local receipt");
  const indexCount = expected.meshTriangles * 3;
  const positions = new Float32Array(
    meshes.reduce((count, mesh) => count + mesh.vertexCount * 3, 0),
  );
  const indices = new Uint32Array(indexCount);
  const uv =
    bindings === undefined
      ? null
      : new Float32Array((positions.length / 3) * 2);
  const groups = [];
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of meshes) {
    const exactReplacement =
      ((mesh.flags === 2 && mesh.controller === 0xd1a17399) ||
        (mesh.flags === 4 &&
          (mesh.controller === 0x1804e2e4 ||
            mesh.controller === 0x48106271))) &&
      visibilityTracks.has(mesh.controller) &&
      bindings !== undefined &&
      mesh.submeshes.every(({ material }) => bindings.has(material));
    if (
      ((mesh.flags & 1) !== 1 && !exactReplacement) ||
      !Number.isSafeInteger(mesh.vertexCount) ||
      mesh.vertexCount < 1 ||
      !Number.isSafeInteger(mesh.indexCount) ||
      mesh.indexCount < 3 ||
      mesh.indexCount % 3 !== 0
    )
      throw Error("Invalid Map11 mesh record");
    const vertices = new Float32Array(
      bytes,
      mesh.positionOffset,
      mesh.vertexCount * 3,
    );
    const localIndices = new Uint32Array(
      bytes,
      mesh.indexOffset,
      mesh.indexCount,
    );
    if (
      !vertices.every(Number.isFinite) ||
      indexOffset + localIndices.length > indices.length
    )
      throw Error("Invalid Map11 mesh vertices or index totals");
    positions.set(vertices, vertexOffset * 3);
    if (uv !== null) {
      let start = 0;
      for (const submesh of mesh.submeshes) {
        if (
          typeof submesh.material !== "string" ||
          submesh.start !== start ||
          !Number.isSafeInteger(submesh.count) ||
          submesh.count < 3 ||
          submesh.count % 3 !== 0 ||
          submesh.start + submesh.count > mesh.indexCount
        )
          throw Error("Invalid Map11 material index range");
        groups.push({
          material: submesh.material,
          controllerId: mesh.controller,
          indexOffset: indexOffset + start,
          indexCount: submesh.count,
        });
        start += submesh.count;
      }
      if (start !== mesh.indexCount)
        throw Error("Incomplete Map11 material index ranges");
      if (mesh.hasUv) {
        const coordinates = new Float32Array(
          bytes,
          mesh.uvOffset,
          mesh.vertexCount * 2,
        );
        if (!coordinates.every(Number.isFinite))
          throw Error("Invalid authored Map11 UV");
        uv.set(coordinates, vertexOffset * 2);
      } else if (
        mesh.submeshes.some(({ material }) => bindings.has(material))
      ) {
        throw Error("Authored Map11 material has no texture coordinates");
      }
    }
    for (const index of localIndices) {
      if (index >= mesh.vertexCount)
        throw Error("Map11 mesh index out of bounds");
      indices[indexOffset++] = index + vertexOffset;
    }
    vertexOffset += mesh.vertexCount;
  }
  if (indexOffset !== indexCount) throw Error("Incomplete Map11 mesh indices");
  return { positions, indices, uv, groups };
}

function uploadDiffuseTextures(gl, bindings) {
  const textures = new Map();
  const materials = new Map();
  for (const [material, { image, alphaTest, sourceAlphaBlend }] of bindings ??
    []) {
    let texture = textures.get(image);
    if (texture === undefined) {
      texture = gl.createTexture();
      if (texture === null) throw Error("Could not allocate Map11 texture");
      textures.set(image, texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Match the retained renderer's unflipped UVs, opaque color and repeat.
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
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
      if (gl.getError() !== gl.NO_ERROR)
        throw Error("Could not upload Map11 diffuse texture");
    }
    materials.set(material, { texture, alphaTest, sourceAlphaBlend });
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { materials, textures };
}

export function createTerrainRenderer(
  canvas,
  metadata,
  bytes,
  scene,
  {
    bindings,
    championModels,
    structureModels,
    nexusModels,
    inhibitorModels,
    worldUnitModels,
    animationPalettesAt,
    turretCollapseAt,
    recordedParticles,
  } = {},
) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    depth: true,
    antialias: true,
  });
  if (!gl || !gl.getContextAttributes().depth)
    throw Error("WebGL2 with a depth buffer is required");
  const program = createProgram(gl);
  gl.useProgram(program);
  const matrix = gl.getUniformLocation(program, "viewProjection");
  const markers = gl.getUniformLocation(program, "markers");
  const pointSize = gl.getUniformLocation(program, "pointSize");
  const textured = gl.getUniformLocation(program, "textured");
  const alphaTest = gl.getUniformLocation(program, "alphaTest");
  const sourceAlphaBlend = gl.getUniformLocation(program, "sourceAlphaBlend");
  gl.uniform1i(gl.getUniformLocation(program, "diffuse"), 0);
  const visibilityTracks = new Map();
  for (const { controllerId, points } of scene.terrainVisibility?.tracks ??
    []) {
    if (
      visibilityTracks.has(controllerId) ||
      points[0][0] !== 0 ||
      points.some(([second], i) => i > 0 && second <= points[i - 1][0])
    )
      throw Error("Invalid recorded Map11 terrain visibility track");
    visibilityTracks.set(controllerId, points);
  }
  const { positions, indices, uv, groups } = terrainArrays(
    metadata,
    bytes,
    scene.staticMesh,
    bindings,
    visibilityTracks,
  );
  const { materials, textures } = uploadDiffuseTextures(gl, bindings);
  const opaqueTerrain = [];
  const blendedTerrain = [];
  const omittedControllers = new Set(
    scene.terrainVisibility?.omittedMeshControllerIds,
  );
  const unresolvedByController = new Map();
  for (const window of scene.terrainVisibility?.unresolvedWindows ?? []) {
    const windows = unresolvedByController.get(window.controllerId) ?? [];
    windows.push(window);
    unresolvedByController.set(window.controllerId, windows);
  }
  for (const group of groups) {
    if (omittedControllers.has(group.controllerId)) continue;
    const binding = materials.get(group.material);
    if (binding === undefined) continue;
    const pass =
      binding.sourceAlphaBlend === true ? blendedTerrain : opaqueTerrain;
    pass.push({
      ...group,
      ...binding,
      visibility: visibilityTracks.get(group.controllerId),
      windows: unresolvedByController.get(group.controllerId),
    });
  }
  function drawTerrainGroup(
    time,
    {
      indexOffset,
      indexCount,
      texture,
      alphaTest: cutoff,
      visibility,
      windows,
    },
  ) {
    if (
      windows?.some(
        ({ startSeconds, endSeconds }) =>
          time >= startSeconds && time < endSeconds,
      )
    )
      return;
    if (visibility !== undefined) {
      let i = visibility.length - 1;
      while (i > 0 && visibility[i][0] > time) i--;
      if (!visibility[i][1]) return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1f(alphaTest, cutoff);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, indexOffset * 4);
  }
  const terrain = gl.createVertexArray();
  const terrainPositions = gl.createBuffer();
  const terrainIndices = gl.createBuffer();
  gl.bindVertexArray(terrain);
  gl.bindBuffer(gl.ARRAY_BUFFER, terrainPositions);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const terrainUv = uv === null ? null : gl.createBuffer();
  if (uv !== null) {
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainUv);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIndices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const markerArray = gl.createVertexArray();
  const markerBuffer = gl.createBuffer();
  gl.bindVertexArray(markerArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, markerBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
  const { min, max } = scene.mapBounds;
  const center = new Vector3((min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2);
  const corners = [min[0], max[0]].flatMap((x) =>
    [min[1], max[1]].flatMap((y) =>
      [min[2], max[2]].map((z) => new Vector3(x, y, z).sub(center)),
    ),
  );
  const overviewFov = 48;
  const overviewNearClip = 100;
  const overviewFarClip = 100_000;
  const camera = new PerspectiveCamera(
    overviewFov,
    1,
    overviewNearClip,
    overviewFarClip,
  );
  const worldUp = new Vector3(0, 1, 0);
  let dragView;
  let modelRenderer;
  let overhead;
  const inactiveInhibitorModels = new Set(
    (scene.inhibitorModels?.bindings ?? []).flatMap(
      ({ participantId, inactiveModelRange }) =>
        inactiveModelRange === "Destroyed" ? [participantId] : [],
    ),
  );
  const turretRubbleDelays = new Map(
    (scene.structureModels?.bindings ?? []).flatMap(
      ({ participantId, settledRubble }) =>
        settledRubble === undefined
          ? []
          : [[participantId, settledRubble.afterSeconds]],
    ),
  );
  let disposed = false;
  let particleRenderer;
  function dispose() {
    if (disposed) return;
    disposed = true;
    particleRenderer?.dispose();
    overhead?.dispose();
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.deleteVertexArray(terrain);
    gl.deleteVertexArray(markerArray);
    gl.deleteBuffer(terrainPositions);
    gl.deleteBuffer(terrainIndices);
    gl.deleteBuffer(terrainUv);
    gl.deleteBuffer(markerBuffer);
    modelRenderer?.dispose();
    for (const texture of textures.values()) gl.deleteTexture(texture);
    gl.deleteProgram(program);
  }
  try {
    if (recordedParticles !== undefined)
      particleRenderer = createRecordedParticleRenderer(
        gl,
        recordedParticles.assets,
      );
    if (
      championModels !== undefined ||
      structureModels !== undefined ||
      nexusModels !== undefined ||
      inhibitorModels !== undefined ||
      worldUnitModels !== undefined
    ) {
      const models = new Map([
        ...(championModels ?? []),
        ...(structureModels ?? []),
        ...(nexusModels ?? []),
        ...(inhibitorModels ?? []),
        ...(worldUnitModels ?? []),
      ]);
      if (
        models.size !==
        (championModels?.size ?? 0) +
          (structureModels?.size ?? 0) +
          (nexusModels?.size ?? 0) +
          (inhibitorModels?.size ?? 0) +
          (worldUnitModels?.size ?? 0)
      )
        throw Error("Duplicate terrain model binding");
      if (structureModels !== undefined && scene.structureModels === undefined)
        throw Error("Missing replay-bound structure positions");
      if (nexusModels !== undefined && scene.nexusModels === undefined)
        throw Error("Missing replay-bound Nexus positions");
      if (inhibitorModels !== undefined && scene.inhibitorModels === undefined)
        throw Error("Missing replay-bound inhibitor positions");
      if (worldUnitModels !== undefined && scene.worldUnitModels === undefined)
        throw Error("Missing replay-bound world unit positions");
      modelRenderer = createChampionModelRenderer(gl, models, createProgram);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  function drawMarkers(vertices, size) {
    if (vertices.length === 0) return;
    // Markers are observations at the authored XYZ, including placements
    // inside the terrain surface. Keep those points readable as overlays.
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1i(markers, 1);
    gl.uniform1f(pointSize, size);
    gl.bindVertexArray(markerArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, markerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, vertices.length / 4);
  }

  function draw(frame, elevation, options = {}) {
    if (disposed) throw Error("The terrain renderer has been disposed");
    const ratio = Math.min(options.devicePixelRatio ?? devicePixelRatio, 2);
    const width = Math.max(
      1,
      Math.round((options.width ?? canvas.clientWidth) * ratio),
    );
    const height = Math.max(
      1,
      Math.round((options.height ?? canvas.clientHeight) * ratio),
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    camera.aspect = width / height;
    const follow =
      options.useFollowDefaults === true
        ? scene.followCameraDefaults
        : undefined;
    camera.fov = follow?.verticalFovDegrees ?? overviewFov;
    camera.near = follow?.nearClip ?? overviewNearClip;
    const zoom = options.zoom ?? 1;
    const farClipping = follow?.farClipping;
    camera.far =
      farClipping === undefined
        ? overviewFarClip
        : farClipping.base + farClipping.configuredDistance / zoom;
    camera.updateProjectionMatrix();
    const tangent = Math.tan((camera.fov * Math.PI) / 360);
    const tilt = ((follow?.pitchDegrees ?? elevation) * Math.PI) / 180;
    const direction = new Vector3(
      follow === undefined ? 0.18 * Math.cos(tilt) : 0,
      Math.sin(tilt),
      -Math.cos(tilt),
    ).normalize();
    const right = new Vector3().crossVectors(worldUp, direction).normalize();
    const up = new Vector3().crossVectors(direction, right);
    // Fit the playable navigation bounds under perspective on both axes.
    const distance = Math.max(
      ...corners.map(
        (point) =>
          point.dot(direction) +
          1.1 *
            Math.max(
              Math.abs(point.dot(right)) / (tangent * camera.aspect),
              Math.abs(point.dot(up)) / tangent,
            ),
      ),
    );
    const focus =
      options.focus === undefined ? center : new Vector3(...options.focus);
    const focusDistance = options.distance ?? distance * 0.42;
    if (
      options.focus !== undefined &&
      (!Number.isFinite(focusDistance) || focusDistance <= 0)
    )
      throw Error("Invalid focused terrain camera distance");
    const viewDistance =
      (options.focus === undefined ? distance : focusDistance) / zoom;
    camera.position.copy(focus).addScaledVector(direction, viewDistance);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    dragView = {
      focus,
      right,
      // Project camera-up onto the ground along the viewing direction.
      groundUp: up.clone().addScaledVector(direction, -up.y / direction.y),
      distance: viewDistance,
      unitsPerPixel: (2 * viewDistance * tangent * ratio) / height,
    };
    const viewProjection = camera.projectionMatrix
      .clone()
      .multiply(camera.matrixWorldInverse);
    gl.useProgram(program);
    gl.uniformMatrix4fv(matrix, false, viewProjection.elements);
    gl.clearColor(...terrainClearColor);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1i(markers, 0);
    gl.bindVertexArray(terrain);
    if (bindings === undefined) {
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    } else {
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(textured, 1);
      gl.uniform1i(sourceAlphaBlend, 0);
      for (const group of opaqueTerrain)
        drawTerrainGroup(frame.timeSeconds, group);
      if (blendedTerrain.length > 0) {
        gl.uniform1i(sourceAlphaBlend, 1);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        for (const group of blendedTerrain)
          drawTerrainGroup(frame.timeSeconds, group);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }
    if (modelRenderer !== undefined) {
      const visible = (context) => options.isVisible?.(context) ?? true;
      const structures = scene.structureModels?.instances ?? [];
      const visibleStructures =
        structureModels === undefined
          ? []
          : structures.flatMap((instance) => {
              if (!visible(instance.context)) return [];
              const { destroyedAtSeconds, participantId } = instance;
              if (
                destroyedAtSeconds === null ||
                frame.timeSeconds < destroyedAtSeconds
              )
                return [instance];
              const delay = turretRubbleDelays.get(participantId);
              const elapsed = frame.timeSeconds - destroyedAtSeconds;
              if (delay !== undefined && elapsed >= delay)
                return [{ ...instance, inactive: true }];
              if (participantId === 1 && turretCollapseAt !== undefined)
                return [
                  {
                    ...instance,
                    ...turretCollapseAt(instance.context, elapsed),
                  },
                ];
              return [];
            });
      modelRenderer.draw(
        viewProjection.elements,
        championModels === undefined ? [] : frame.markers,
        animationPalettesAt?.(frame.timeSeconds, frame.markers),
      );
      if (worldUnitModels !== undefined)
        modelRenderer.draw(viewProjection.elements, frame.worldUnits ?? []);
      if (structureModels !== undefined || nexusModels !== undefined)
        modelRenderer.draw(viewProjection.elements, visibleStructures);
      if (nexusModels !== undefined) {
        const { instances, terminalLoss, cue } = scene.nexusModels;
        const loss = terminalLoss ?? cue;
        modelRenderer.draw(
          viewProjection.elements,
          instances.filter(
            ({ context }) =>
              visible(context) &&
              (context !== loss.context ||
                frame.timeSeconds < loss.timeSeconds),
          ),
        );
      }
      if (inhibitorModels !== undefined) {
        modelRenderer.draw(
          viewProjection.elements,
          scene.inhibitorModels.instances.flatMap((instance) => {
            if (!visible(instance.context)) return [];
            if (inhibitorIsActive(instance, frame.timeSeconds))
              return [instance];
            if (
              instance.inactiveRanges === undefined ||
              !inactiveInhibitorModels.has(instance.participantId)
            )
              return [];
            return [{ ...instance, inactive: true }];
          }),
        );
      }
      gl.useProgram(program);
    }
    if (structureModels === undefined && scene.turretLosses?.length > 0) {
      const time = options.timeSeconds ?? frame.timeSeconds;
      if (!Number.isFinite(time))
        throw Error("The turret overlay requires the replay clock");
      const alive = scene.turretLosses.filter(
        ({ timeSeconds }) => time < timeSeconds,
      );
      drawMarkers(
        alive.flatMap(({ worldPosition }) => [...worldPosition, 0]),
        9 * ratio,
      );
    }
    if (championModels === undefined)
      drawMarkers(
        frame.markers.flatMap(({ position, teamId }) => [...position, teamId]),
        13 * ratio,
      );
    if (particleRenderer !== undefined && options.showRecordedParticles)
      particleRenderer.draw(
        viewProjection.elements,
        camera,
        recordedParticles.sampleAt(frame.timeSeconds),
      );
    if (
      championModels !== undefined &&
      options.championHealthAt !== undefined
    ) {
      drawChampionHealth(
        gl,
        frame,
        options.championHealthAt,
        championModels,
        viewProjection.elements,
        width,
        height,
        ratio,
      );
    }
    const nameplateAt =
      options.focus === undefined ? undefined : options.championNameplateAt;
    if (
      championModels !== undefined &&
      nameplateAt !== undefined &&
      overhead === undefined
    )
      overhead = createChampionOverhead(canvas);
    overhead?.draw(
      frame,
      nameplateAt,
      championModels,
      viewProjection.elements,
      width,
      height,
      ratio,
    );
  }
  function dragFocus(deltaX, deltaY) {
    if (dragView === undefined) throw Error("The terrain camera has no view");
    const { focus, right, groundUp, distance, unitsPerPixel } = dragView;
    const target = focus
      .clone()
      .addScaledVector(right, -deltaX * unitsPerPixel)
      .addScaledVector(groundUp, deltaY * unitsPerPixel);
    return { x: target.x, z: target.z, distance };
  }

  return { draw, dispose, dragFocus };
}
