import type { MatchState } from "@castle-casters/core";
import { assetManifest } from "#src/app/assets.ts";
import { loadTiledMap, resolveTilesetForGid, textureIdForTileset, tileUv, type TiledMap } from "./tiled.ts";

type RenderTexture = {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
};

type Instance = {
  x: number;
  y: number;
  width: number;
  height: number;
  u: number;
  v: number;
  uWidth: number;
  vHeight: number;
};

export type CastleRenderer = {
  render: (match: MatchState, time: number) => void;
  dispose: () => void;
};

export async function createRenderer(canvas: HTMLCanvasElement): Promise<CastleRenderer> {
  if (navigator.gpu === undefined) {
    throw new Error("WebGPU is not available.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) {
    throw new Error("WebGPU adapter is not available.");
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (context === null) {
    throw new Error("Canvas WebGPU context is unavailable.");
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
  const viewportBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: device.createShaderModule({ code: spriteShader }),
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: 32,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: spriteShader }),
      entryPoint: "fragmentMain",
      targets: [{ format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }],
    },
    primitive: { topology: "triangle-list" },
  });

  const textures = new Map<string, RenderTexture>();
  for (const entry of assetManifest.textures) {
    const image = await loadImageBitmap(entry.url);
    const texture = device.createTexture({
      size: [image.width, image.height, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: image }, { texture }, [image.width, image.height]);
    const view = texture.createView();
    textures.set(entry.id, {
      texture,
      view,
      bindGroup: device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: view },
          { binding: 2, resource: { buffer: viewportBuffer } },
        ],
      }),
      width: image.width,
      height: image.height,
    });
  }

  const grassMapUrl = assetManifest.maps["grass"];
  if (grassMapUrl === undefined) {
    throw new Error("Missing grass map URL.");
  }
  const map = await loadTiledMap(grassMapUrl);
  const instanceBuffer = device.createBuffer({ size: 1024 * 1024, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

  return {
    render(match, time) {
      resizeCanvas(canvas);
      device.queue.writeBuffer(viewportBuffer, 0, new Float32Array([canvas.width, canvas.height]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.04, g: 0.05, b: 0.07, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      drawTexture(device, pass, instanceBuffer, textures, "background-purple", [
        { x: 0, y: 0, width: canvas.width, height: canvas.height, u: 0, v: 0, uWidth: 1, vHeight: 1 },
      ]);
      drawMap(device, pass, instanceBuffer, textures, map);
      drawMatch(device, pass, instanceBuffer, textures, match, time);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      for (const texture of textures.values()) {
        texture.texture.destroy();
      }
      viewportBuffer.destroy();
      instanceBuffer.destroy();
    },
  };
}

function drawMap(device: GPUDevice, pass: GPURenderPassEncoder, buffer: GPUBuffer, textures: Map<string, RenderTexture>, map: TiledMap): void {
  const tileSize = 23;
  const instancesByTexture = new Map<string, Instance[]>();
  for (const layer of map.layers) {
    if (!layer.visible) {
      continue;
    }
    for (let index = 0; index < layer.data.length; index += 1) {
      const gid = layer.data[index] ?? 0;
      if (gid === 0) {
        continue;
      }
      const tileset = resolveTilesetForGid(map, gid);
      if (tileset === undefined) {
        continue;
      }
      const textureId = textureIdForTileset(tileset);
      const texture = textures.get(textureId);
      if (texture === undefined) {
        continue;
      }
      const { column, row } = tileUv(gid, tileset.columns, tileset.firstgid);
      const instances = instancesByTexture.get(textureId) ?? [];
      instances.push({
        x: (index % layer.width) * tileSize,
        y: Math.floor(index / layer.width) * tileSize,
        width: tileSize,
        height: tileSize,
        u: (column * tileset.tilewidth) / texture.width,
        v: (row * tileset.tileheight) / texture.height,
        uWidth: tileset.tilewidth / texture.width,
        vHeight: tileset.tileheight / texture.height,
      });
      instancesByTexture.set(textureId, instances);
    }
  }
  for (const [textureId, instances] of instancesByTexture.entries()) {
    drawTexture(device, pass, buffer, textures, textureId, instances);
  }
}

function drawMatch(device: GPUDevice, pass: GPURenderPassEncoder, buffer: GPUBuffer, textures: Map<string, RenderTexture>, match: MatchState, time: number): void {
  const wizardFrame = Math.floor(time / 160) % 3;
  const pawnInstancesByTexture = new Map<string, Instance[]>();
  for (const [playerId, pawn] of Object.entries(match.pawns)) {
    if (pawn === undefined) {
      continue;
    }
    const mapPosition = boardToMapPixels(pawn.x, pawn.y);
    const textureId = wizardTextureForPlayer(playerId);
    const instances = pawnInstancesByTexture.get(textureId) ?? [];
    instances.push({
      x: mapPosition.x,
      y: mapPosition.y,
      width: 32,
      height: 32,
      u: 0,
      v: wizardFrame / 3,
      uWidth: 1,
      vHeight: 1 / 3,
    });
    pawnInstancesByTexture.set(textureId, instances);
  }
  for (const [textureId, instances] of pawnInstancesByTexture.entries()) {
    drawTexture(device, pass, buffer, textures, textureId, instances);
  }

  const wallInstances: Instance[] = [];
  for (const wall of match.walls) {
    for (const coordinate of [wall.start, wall.vertex, wall.end]) {
      const mapPosition = boardToMapPixels(coordinate.x, coordinate.y);
      wallInstances.push({
        x: mapPosition.x,
        y: mapPosition.y,
        width: 24,
        height: 24,
        u: 0,
        v: 0,
        uWidth: 1,
        vHeight: 1,
      });
    }
  }
  drawTexture(device, pass, buffer, textures, "wall-fire", wallInstances);
}

function wizardTextureForPlayer(playerId: string): string {
  if (playerId === "two") {
    return "wizard-ice-front";
  }
  if (playerId === "three") {
    return "wizard-earth-front";
  }
  if (playerId === "four") {
    return "wizard-wind-front";
  }
  return "wizard-fire-front";
}

export function boardToMapPixels(boardX: number, boardY: number): { x: number; y: number } {
  return {
    x: (21 + boardX) * 23,
    y: (14 + 16 - boardY) * 23,
  };
}

function drawTexture(device: GPUDevice, pass: GPURenderPassEncoder, buffer: GPUBuffer, textures: Map<string, RenderTexture>, textureId: string, instances: Instance[]): void {
  const texture = textures.get(textureId);
  if (texture === undefined || instances.length === 0) {
    return;
  }
  const data = new Float32Array(instances.flatMap((instance) => [instance.x, instance.y, instance.width, instance.height, instance.u, instance.v, instance.uWidth, instance.vHeight]));
  device.queue.writeBuffer(buffer, 0, data);
  pass.setBindGroup(0, texture.bindGroup);
  pass.setVertexBuffer(0, buffer);
  pass.draw(6, instances.length);
}

async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load texture ${url}: ${response.statusText}`);
  }
  return createImageBitmap(await response.blob());
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const width = Math.max(1, Math.floor(canvas.clientWidth * window.devicePixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * window.devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

const spriteShader = `
struct Viewport {
  size: vec2f,
};

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var spriteSampler: sampler;
@group(0) @binding(1) var spriteTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> viewport: Viewport;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @location(0) rect: vec4f, @location(1) uvRect: vec4f) -> VertexOut {
  let positions = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let uvs = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let canvas = viewport.size;
  let pixel = rect.xy + positions[vertexIndex] * rect.zw;
  var output: VertexOut;
  output.position = vec4f((pixel.x / canvas.x) * 2.0 - 1.0, 1.0 - (pixel.y / canvas.y) * 2.0, 0.0, 1.0);
  output.uv = uvRect.xy + uvs[vertexIndex] * uvRect.zw;
  return output;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let color = textureSample(spriteTexture, spriteSampler, input.uv);
  if (color.a <= 0.01) {
    discard;
  }
  return color;
}
`;
