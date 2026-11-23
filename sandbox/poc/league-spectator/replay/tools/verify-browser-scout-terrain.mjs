import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createNavgridGroundHeight } from "./research/native-terrain-ground.mjs";
import { sampleNativeTerrainMotion } from "./research/native-terrain-motion-sample.mjs";

const [origin, outputPath, referenceOrigin] = process.argv.slice(2);
assert.ok(
  origin && outputPath,
  "Usage: bun verify-browser-scout-terrain.mjs <loopback URL> <private output directory> [reference loopback URL]",
);
const url = new URL("/scout", origin);
assert.equal(url.hostname, "127.0.0.1");
const referenceSceneUrl =
  referenceOrigin === undefined
    ? null
    : new URL("/scene.json", referenceOrigin);
if (referenceSceneUrl !== null)
  assert.equal(referenceSceneUrl.hostname, "127.0.0.1");
const require = createRequire(
  new URL(
    "../../../../../packages/scout-for-lol/packages/app/package.json",
    import.meta.url,
  ),
);
const { chromium, expect } = require("@playwright/test");
await mkdir(outputPath, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});

try {
  const summaries = [];
  for (const { name, deviceScaleFactor, ...viewport } of [
    { name: "desktop", width: 1100, height: 850, deviceScaleFactor: 1 },
    { name: "narrow", width: 390, height: 780, deviceScaleFactor: 2 },
  ]) {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const errors = [];
    const workerUrls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("worker", (worker) => workerUrls.push(worker.url()));
    await page.addInitScript(() => {
      const state = (window.scoutTerrainCheck = {});
      const proto = WebGL2RenderingContext.prototype;
      let texturedUniform;
      let textured = false;
      let actorProgram;
      let currentProgram;
      let actorOrigin;
      let actorScale;
      let actorBasis;
      let actorMatrix;
      let currentBatch;
      let pendingActor;
      const viewMatrices = new WeakMap();
      for (const method of [
        "useProgram",
        "uniformMatrix4fv",
        "uniformMatrix3fv",
        "getUniformLocation",
        "uniform1i",
        "uniform1f",
        "uniform3fv",
        "texImage2D",
        "clear",
        "drawElements",
        "drawArrays",
        "bufferData",
      ]) {
        const original = proto[method];
        proto[method] = function (...args) {
          if (method === "getUniformLocation") {
            const location = original.apply(this, args);
            if (args[1] === "textured") texturedUniform = location;
            if (args[1] === "viewProjection")
              viewMatrices.set(args[0], location);
            if (args[1] === "actorOrigin") {
              actorProgram = args[0];
              actorMatrix = viewMatrices.get(actorProgram);
              actorOrigin = location;
            }
            if (args[1] === "actorScale") actorScale = location;
            if (args[1] === "actorBasis") actorBasis = location;
            return location;
          }
          if (method === "useProgram") currentProgram = args[0];
          if (method === "uniform1i" && args[0] === texturedUniform)
            textured = args[1] !== 0;
          if (method === "uniform3fv" && args[0] === actorOrigin)
            pendingActor = {
              position: [...Float32Array.from(args[1])],
              draws: [],
            };
          if (method === "uniform1f" && args[0] === actorScale && pendingActor)
            pendingActor.scale = Math.fround(args[1]);
          if (
            method === "uniformMatrix3fv" &&
            args[0] === actorBasis &&
            pendingActor
          )
            pendingActor.basis = [...Float32Array.from(args[2])];
          if (method === "texImage2D" && args.at(-1) instanceof ImageBitmap)
            state.textureUploads = (state.textureUploads ?? 0) + 1;
          if (method === "uniformMatrix4fv") {
            state.matrix = [...args[2]];
            if (args[0] === actorMatrix && currentProgram === actorProgram) {
              currentBatch = [];
              state.modelBatches.push(currentBatch);
            }
          }
          if (method === "bufferData" && args[2] === this.DYNAMIC_DRAW)
            state.pointVertices = [...args[1]];
          if (method === "clear") {
            if (
              state.movementFrames &&
              state.movementFrames.length < 120 &&
              state.modelBatches?.[0]?.length
            ) {
              state.movementFrames.push({
                vertices: state.modelBatches[0].flatMap(
                  ({ position }) => position,
                ),
                matrix: state.modelFrameMatrix,
              });
            }
            state.modelBatches = [];
            currentBatch = undefined;
            pendingActor = undefined;
            state.terrainIndices = 0;
            state.texturedIndices = 0;
            state.markerCount = 0;
            state.turretCount = 0;
            state.width = this.drawingBufferWidth;
            state.height = this.drawingBufferHeight;
          }
          if (method === "drawElements") {
            if (currentProgram === actorProgram && pendingActor) {
              if (pendingActor.draws.length === 0)
                currentBatch.push(pendingActor);
              pendingActor.draws.push(args[1]);
              state.modelFrameMatrix = state.matrix;
            } else {
              state.terrainIndices += args[1];
              if (textured) state.texturedIndices += args[1];
            }
          }
          if (method === "drawArrays" && args[0] === this.POINTS) {
            if (state.pointVertices[3] === 0) {
              state.turretCount = args[2];
              state.turretVertices = state.pointVertices;
            } else {
              state.markerCount = args[2];
              state.markerVertices = state.pointVertices;
              if (state.movementFrames && state.movementFrames.length < 120) {
                state.movementFrames.push({
                  vertices: state.markerVertices,
                  matrix: state.matrix,
                });
              }
            }
          }
          original.apply(this, args);
        };
      }
    });
    await page.goto(url.href);
    const player = page.getByRole("region", { name: "Replay player" });
    const play = player.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeVisible();
    const readDraw = async () => {
      const draw = await page.evaluate(() => window.scoutTerrainCheck);
      if (!modelProof) return draw;
      const modelPlacements = draw.modelBatches[0];
      return {
        ...draw,
        modelPlacements,
        markerCount: modelPlacements.length,
        markerVertices: modelPlacements.flatMap(({ position }) => position),
      };
    };
    async function readScene(sceneUrl) {
      const response = await page.request.get(sceneUrl.href);
      assert.equal(response.status(), 200);
      return response.json();
    }
    const scene = await readScene(new URL("/scene.json", url));
    async function readModelProof(set, directory) {
      if (set === undefined) return null;
      return new Map(
        await Promise.all(
          set.bindings.map(async (binding) => {
            const path = new URL(binding.url, url);
            assert.equal(path.origin, url.origin);
            const response = await page.request.get(path.href);
            assert.equal(response.status(), 200);
            assert.equal(
              response.headers()["content-type"],
              "model/gltf-binary",
            );
            const bytes = await response.body();
            assert.equal(
              path.pathname,
              `/${directory}/${createHash("sha256").update(bytes).digest("hex")}.glb`,
            );
            assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
            assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
            const gltf = JSON.parse(
              bytes.subarray(20, 20 + bytes.readUInt32LE(12)),
            );
            const hidden = new Set(
              binding.hiddenRanges.map((name) => name.toLowerCase()),
            );
            const primitives = gltf.meshes[0].primitives.filter(
              (primitive) =>
                !hidden.has(
                  gltf.materials[primitive.material].name.toLowerCase(),
                ),
            );
            const draws = primitives.map(
              ({ indices }) => gltf.accessors[indices].count,
            );
            const images = new Set(
              primitives.map(({ material }) => {
                const { index } =
                  gltf.materials[material].pbrMetallicRoughness
                    .baseColorTexture;
                return gltf.textures[index].source;
              }),
            );
            assert.ok(
              draws.length &&
                draws.every((count) => count > 0 && count % 3 === 0),
            );
            return [
              binding.participantId,
              {
                draws,
                scale: Math.fround(binding.skinScale ?? 1),
                textures: images.size,
              },
            ];
          }),
        ),
      );
    }
    const [modelProof, structureProof, nexusProof] = await Promise.all([
      readModelProof(scene.championModels, "champion-models"),
      readModelProof(scene.structureModels, "structure-models"),
      readModelProof(scene.nexusModels, "nexus-models"),
    ]);
    function expectedWorldDraws(instances, proof) {
      return instances.map(({ participantId, position, basis }) => {
        const { draws, scale } = proof.get(participantId);
        return {
          position: [...Float32Array.from(position)],
          draws,
          scale,
          basis: [...Float32Array.from(basis)],
        };
      });
    }
    function assertStructures(draw, timeSeconds) {
      if (!structureProof) return;
      const expected = scene.structureModels.instances.filter(
        ({ destroyedAtSeconds }) =>
          destroyedAtSeconds === null || timeSeconds < destroyedAtSeconds,
      );
      assert.deepEqual(
        draw.modelBatches[1],
        expectedWorldDraws(expected, structureProof),
      );
      assert.equal(draw.turretCount, 0);
      return expected.length;
    }
    function assertNexus(draw, timeSeconds) {
      if (!nexusProof) return;
      const { instances, cue } = scene.nexusModels;
      const visible = instances.filter(
        ({ context }) =>
          context !== cue.context || timeSeconds < cue.timeSeconds,
      );
      assert.deepEqual(
        draw.modelBatches[2],
        expectedWorldDraws(visible, nexusProof),
      );
      return visible.length;
    }
    const terrainTriangles =
      scene.terrainMaterials?.texturedTriangles ??
      scene.staticMesh.meshTriangles;
    const shortReplay =
      scene.identity.replaySha256 ===
      "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b";
    const workerScript = new URL("/replay-motion-worker.mjs", url).href;
    let usedMotionWorker = false;
    if (scene.workerMotion !== undefined) {
      assert.ok(
        referenceSceneUrl,
        "Worker mode requires a reference scene origin",
      );
      assert.equal(scene.motion, undefined);
      assert.equal(scene.decodedPositionFrames, undefined);
      const reference = await readScene(referenceSceneUrl);
      assert.deepEqual(reference.identity, scene.identity);
      assert.deepEqual(reference.participants, scene.participants);
      assert.deepEqual(reference.championModels, scene.championModels);
      assert.deepEqual(reference.structureModels, scene.structureModels);
      assert.deepEqual(reference.nexusModels, scene.nexusModels);
      assert.equal(reference.winningTeam, scene.winningTeam);
      assert.ok(reference.motion && reference.decodedPositionFrames?.length);
      scene.motion = reference.motion;
      scene.decodedPositionFrames = reference.decodedPositionFrames;
      assert.ok(
        workerUrls.includes(workerScript),
        "Expected a dedicated replay motion worker",
      );
      usedMotionWorker = true;
    } else {
      assert.equal(
        referenceSceneUrl,
        null,
        "Reference origin is for worker mode",
      );
    }
    const vertexArray = (markers) => [
      ...Float32Array.from(
        markers.flatMap(({ position, teamId }) =>
          modelProof ? position : [...position, teamId],
        ),
      ),
    ];
    const assertActorDraws = (draw, markers) => {
      assert.equal(draw.markerCount, markers.length);
      assert.deepEqual(draw.markerVertices, vertexArray(markers));
      if (modelProof) {
        assert.deepEqual(
          draw.modelPlacements.map(({ draws, scale }) => ({ draws, scale })),
          markers.map(({ participantId }) => {
            const { draws, scale } = modelProof.get(participantId);
            return { draws, scale };
          }),
        );
      }
    };
    const recorded = scene.frames.filter(({ markers }) => markers.length);
    const snapshots = player.getByRole("group", {
      name: "Captured replay times",
    });
    const scale = player.getByRole("slider", { name: "Replay time" });
    const camera = player.getByRole("combobox", { name: /^Camera\b/ });
    const map = player.getByRole("button", { name: /^Free camera map/ });
    async function assertMinimapTurrets(timeSeconds) {
      const dots = map.locator("[data-minimap-turret]");
      const expected =
        scene.structureModels?.instances.filter(
          ({ destroyedAtSeconds }) =>
            destroyedAtSeconds === null || timeSeconds < destroyedAtSeconds,
        ) ?? [];
      await expect(dots).toHaveCount(expected.length);
      const points = await dots.evaluateAll((nodes) =>
        nodes.map((node) => ({
          context: Number(node.dataset.minimapTurret),
          x: Number.parseFloat(node.style.left) / 100,
          y: Number.parseFloat(node.style.top) / 100,
        })),
      );
      const { min, max } = scene.mapBounds;
      for (const [index, dot] of points.entries()) {
        const {
          context,
          position: [x, , z],
        } = expected[index];
        assert.equal(dot.context, context);
        assert.ok(Math.abs(dot.x - (x - min[0]) / (max[0] - min[0])) < 0.00001);
        assert.ok(Math.abs(dot.y - (max[2] - z) / (max[2] - min[2])) < 0.00001);
      }
    }
    async function checkMapDots(markers) {
      if (scene.minimap !== true) return;
      const { min, max } = scene.mapBounds;
      const expected = markers.flatMap(
        ({ participantId, position: [x, , z], teamId }) =>
          x < min[0] || x > max[0] || z < min[2] || z > max[2]
            ? []
            : [
                {
                  participantId,
                  teamId,
                  x: (100 * (x - min[0])) / (max[0] - min[0]),
                  y: (100 * (max[2] - z)) / (max[2] - min[2]),
                },
              ],
      );
      const dots = await map
        .locator("[data-minimap-dot]")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            participantId: Number(node.dataset.minimapDot),
            teamId: Number(node.dataset.team),
            x: Number.parseFloat(node.style.left),
            y: Number.parseFloat(node.style.top),
          })),
        );
      assert.equal(dots.length, expected.length);
      for (const { participantId, teamId, x, y } of expected) {
        const dot = dots.find((dot) => dot.participantId === participantId);
        assert.equal(dot?.teamId, teamId);
        assert.ok(Math.abs(dot.x - x) < 0.0001 && Math.abs(dot.y - y) < 0.0001);
      }
    }
    const vision = player.getByLabel("Vision");
    await expect(vision).toBeDisabled();
    await expect(
      camera.getByRole("option", { name: "Directed camera" }),
    ).toHaveCount(0);
    await expect(snapshots.getByRole("button")).toHaveCount(recorded.length);
    if (!recorded.length) await expect(snapshots).toHaveCount(0);
    let verifiedMarkers = 0;
    for (const { timeSeconds, markers } of recorded) {
      const button = snapshots.getByRole("button", {
        name: `${timeSeconds.toFixed(3)} s`,
        exact: true,
      });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      const draw = await readDraw();
      assertActorDraws(draw, markers);
      assert.equal(draw.terrainIndices, terrainTriangles * 3);
      verifiedMarkers += markers.length;
    }
    const observedFrames = recorded.length
      ? recorded
      : scene.decodedPositionFrames;
    assert.ok(
      observedFrames?.length >= 2,
      "Expected replay positions to compare",
    );
    const observed = observedFrames.at(-1);
    if (!recorded.length) {
      await player
        .getByLabel("Decoded champion positions")
        .selectOption(String(observed.timeSeconds));
    }
    await page.screenshot({
      path: join(outputPath, `${name}-observed.png`),
      fullPage: true,
    });
    const overview = await readDraw();
    assertStructures(overview, observed.timeSeconds);
    assertNexus(overview, observed.timeSeconds);
    assert.equal(overview.terrainIndices, terrainTriangles * 3);
    let terrainMaterialCoverage;
    if (scene.terrainMaterials !== undefined) {
      const images = new Set(
        scene.terrainMaterials.bindings.map(({ url }) => url),
      );
      const modelTextures = [
        ...(modelProof?.values() ?? []),
        ...(structureProof?.values() ?? []),
        ...(nexusProof?.values() ?? []),
      ].reduce((total, model) => total + model.textures, 0);
      assert.equal(overview.textureUploads, images.size + modelTextures);
      assert.equal(
        overview.texturedIndices,
        scene.terrainMaterials.texturedTriangles * 3,
      );
      terrainMaterialCoverage = {
        textures: images.size,
        triangles: overview.texturedIndices / 3,
        omittedTriangles: scene.staticMesh.meshTriangles - terrainTriangles,
      };
    }
    if (scene.minimap === true) {
      await expect(map).toBeVisible();
      await checkMapDots(observed.markers);
      await assertMinimapTurrets(observed.timeSeconds);
      assert.ok(
        await map
          .locator("img")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      );
      const bounds = await map.boundingBox();
      assert.ok(bounds);
      const time = await scale.inputValue();
      await map.click({
        position: { x: bounds.width * 0.24, y: bounds.height * 0.35 },
      });
      const clicked = (await readDraw()).matrix;
      assert.notDeepEqual(clicked, overview.matrix);
      await map.press("ArrowRight");
      const keyed = (await readDraw()).matrix;
      assert.notDeepEqual(keyed, clicked);
      const dragBounds = await map.boundingBox();
      assert.ok(dragBounds);
      await page.mouse.move(
        dragBounds.x + dragBounds.width / 2,
        dragBounds.y + dragBounds.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        dragBounds.x + dragBounds.width + 12,
        dragBounds.y + dragBounds.height * 0.78,
      );
      await page.mouse.up();
      assert.notDeepEqual((await readDraw()).matrix, keyed);
      await expect(scale).toHaveValue(time);
      await page.screenshot({
        path: join(outputPath, `${name}-free-camera.png`),
        fullPage: true,
      });
      await map.press("Home");
      assert.deepEqual((await readDraw()).matrix, overview.matrix);
      await map.press("ArrowDown");
      assert.notDeepEqual((await readDraw()).matrix, overview.matrix);
      await player.getByRole("button", { name: "Reset camera" }).click();
      assert.deepEqual((await readDraw()).matrix, overview.matrix);
    }
    const follow = `player:${observed.markers[0].participantId}`;
    await camera.selectOption(follow);
    assert.notDeepEqual((await readDraw()).matrix, overview.matrix);
    await player.getByRole("button", { name: "Copy replay link" }).click();
    await expect(player.getByText("Replay link copied.")).toBeVisible();
    const share = new URL(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    assert.equal(share.searchParams.get("t"), String(observed.timeSeconds));
    assert.equal(
      share.searchParams.get("follow"),
      follow.slice("player:".length),
    );

    const gap = String(
      Math.round(
        (observedFrames[0].timeSeconds + observedFrames[1].timeSeconds) * 5,
      ) / 10,
    );
    let markersInGap;
    if (scene.motion === undefined) {
      await scale.fill(gap);
      await expect(
        player.getByText("No positions at this replay time."),
      ).toBeVisible();
      const unsampled = await readDraw();
      markersInGap = unsampled.markerCount;
      assert.equal(markersInGap, 0);
      assert.deepEqual(unsampled.matrix, overview.matrix);
      await player.getByLabel("Speed").selectOption("4");
      await play.click();
      await expect
        .poll(async () => Number(await scale.inputValue()))
        .toBeGreaterThan(Number(gap) + 1);
      await player.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(play).toBeVisible();
      assert.equal((await readDraw()).markerCount, 0);
      await page.screenshot({
        path: join(outputPath, `${name}-gap.png`),
        fullPage: true,
      });
    }

    share.searchParams.set("perspective", "blue");
    await page.goto(share.href);
    await expect(camera).toHaveValue(follow);
    await expect(vision).toHaveValue("all");
    await expect(
      player.getByText(
        `${observed.markers.length} ${recorded.length ? "captured camera attachments" : "decoded champion positions"} at ${observed.timeSeconds.toFixed(3)} s.`,
      ),
    ).toBeVisible();
    const dimensions = await page.locator("canvas").evaluate((canvas) => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      documentWidth: document.documentElement.scrollWidth,
    }));
    const canvas = await readDraw();
    assert.equal(dimensions.documentWidth, viewport.width);
    assert.equal(canvas.width, dimensions.width * deviceScaleFactor);
    assert.ok(
      Math.abs(canvas.height - dimensions.height * deviceScaleFactor) <= 1,
    );
    let turretBoundary = null;
    let turretSeekClock = null;
    if (scene.turretLosses?.length) {
      const firstLoss = scene.turretLosses.reduce((first, loss) =>
        loss.timeSeconds < first.timeSeconds ? loss : first,
      );
      const before = Math.floor(firstLoss.timeSeconds * 10) / 10;
      const after = Number((before + 0.1).toFixed(1));
      assert.deepEqual(firstLoss.worldPosition, [981, 37, 10441]);
      const assertTurrets = (draw, time, count) => {
        if (structureProof) {
          const modelCount = assertStructures(draw, time);
          assert.equal(modelCount, count);
          return modelCount;
        }
        const expected = scene.turretLosses
          .filter((loss) => loss.timeSeconds > time)
          .flatMap(({ worldPosition }) => [...worldPosition, 0]);
        if (scene.motion === undefined) assert.equal(draw.markerCount, 0);
        assert.equal(draw.turretCount, count);
        assert.deepEqual(draw.turretVertices, [...Float32Array.from(expected)]);
        return draw.turretCount;
      };
      if (structureProof && scene.minimap === true) {
        await camera.selectOption("free");
        const bounds = await map.boundingBox();
        const { min, max } = scene.mapBounds;
        const [x, , z] = firstLoss.worldPosition;
        const target = [
          (x - min[0]) / (max[0] - min[0]),
          (max[2] - z) / (max[2] - min[2]),
        ];
        await map.click({
          position: {
            x: bounds.width * target[0],
            y: bounds.height * target[1],
          },
        });
        const observedTarget = await map
          .locator("[data-camera-target]")
          .evaluate((element) =>
            [element.style.left, element.style.top].map(
              (coordinate) => Number.parseFloat(coordinate) / 100,
            ),
          );
        assert.ok(Math.abs(observedTarget[0] - target[0]) * bounds.width < 1.5);
        assert.ok(
          Math.abs(observedTarget[1] - target[1]) * bounds.height < 1.5,
        );
        const zoom = player.getByRole("button", { name: "Close-up camera" });
        await zoom.click();
        await expect(zoom).toHaveAttribute("aria-pressed", "true");
      }
      const sample = async (time, count, screenshot) => {
        await scale.fill(String(time));
        if (scene.motion === undefined) {
          await expect(
            player.getByText("No positions at this replay time."),
          ).toBeVisible();
        }
        const draw = await readDraw();
        const rendered = assertTurrets(draw, time, count);
        if (structureProof && scene.minimap === true)
          await assertMinimapTurrets(time);
        if (screenshot)
          await page.screenshot({
            path: join(outputPath, `${name}-turrets-${screenshot}.png`),
            fullPage: true,
          });
        return rendered;
      };
      const openingCount = structureProof ? 22 : 12;
      const beforeCount = await sample(before, openingCount, "before-loss");
      const afterCount = await sample(after, openingCount - 1, "after-loss");
      const rewindCount = await sample(before, openingCount, null);
      const exactUrl = new URL(url);
      exactUrl.searchParams.set("t", String(firstLoss.timeSeconds));
      if (structureProof && scene.minimap === true) {
        const events = player.getByLabel("Recorded turret losses", {
          exact: true,
        });
        await expect(events.getByRole("option")).toHaveCount(
          scene.turretLosses.length + 1,
        );
        assert.ok((await events.boundingBox()).height >= 48);
        await map.press("Home");
        const firstEvent = String(firstLoss.context);
        await events.selectOption(firstEvent);
        await expect(events).toHaveValue(firstEvent);
        const pan = await map
          .locator("[data-camera-target]")
          .evaluate((element) =>
            [element.style.left, element.style.top].map(
              (coordinate) => Number.parseFloat(coordinate) / 100,
            ),
          );
        const { min, max } = scene.mapBounds;
        const [x, , z] = firstLoss.worldPosition;
        assert.ok(
          Math.abs(pan[0] - (x - min[0]) / (max[0] - min[0])) < 0.00001,
        );
        assert.ok(
          Math.abs(pan[1] - (max[2] - z) / (max[2] - min[2])) < 0.00001,
        );
        await assertMinimapTurrets(firstLoss.timeSeconds);
        assertTurrets(
          await readDraw(),
          firstLoss.timeSeconds,
          openingCount - 1,
        );
        await player.getByRole("button", { name: "Copy replay link" }).click();
        const shared = new URL(
          await page.evaluate(() => navigator.clipboard.readText()),
        );
        assert.equal(shared.href, exactUrl.href);
        turretSeekClock = firstLoss.timeSeconds;

        const follow = `player:${scene.participants[1].participantId}`;
        await camera.selectOption(follow);
        await scale.fill(String(before));
        await events.selectOption(firstEvent);
        await expect(events).toHaveValue(firstEvent);
        await expect(camera).toHaveValue(follow);
      }
      await page.goto(exactUrl.href);
      await expect(play).toBeVisible();
      const exact = await readDraw();
      const exactCount = assertTurrets(
        exact,
        firstLoss.timeSeconds,
        openingCount - 1,
      );
      turretBoundary = {
        before,
        after,
        exactTime: firstLoss.timeSeconds,
        lostMarker: firstLoss.worldPosition,
        counts: [beforeCount, afterCount, rewindCount, exactCount],
      };
    }
    if (scene.structureModels !== undefined && !scene.turretLosses.length) {
      await expect(player.getByLabel("Recorded turret losses")).toHaveCount(0);
    }
    let nexusBoundary = null;
    if (nexusProof) {
      const { cue } = scene.nexusModels;
      const expectedClock = shortReplay ? 72.42225912475585 : 1753.589482421875;
      assert.equal(cue.timeSeconds, expectedClock);
      const before = Math.floor(cue.timeSeconds * 10) / 10;
      await camera.selectOption("free");
      const jump = player.getByRole("button", {
        name: "Jump to Nexus death cue",
        exact: true,
      });
      await jump.click();
      await expect
        .poll(async () => (await readDraw()).modelBatches[2].length)
        .toBe(1);
      const exact = assertNexus(await readDraw(), cue.timeSeconds);
      await player.getByRole("button", { name: "Copy replay link" }).click();
      const shared = new URL(
        await page.evaluate(() => navigator.clipboard.readText()),
      );
      assert.equal(shared.searchParams.get("t"), String(cue.timeSeconds));
      const close = player.getByRole("button", {
        name: "Close-up camera",
        exact: true,
      });
      if ((await close.getAttribute("aria-pressed")) === "false")
        await close.click();
      await page.screenshot({
        path: join(outputPath, `${name}-nexus-at-cue.png`),
        fullPage: true,
      });
      await scale.fill(String(before));
      const rewind = assertNexus(await readDraw(), before);
      assert.deepEqual([exact, rewind], [1, 2]);
      await page.screenshot({
        path: join(outputPath, `${name}-nexus-before-cue.png`),
        fullPage: true,
      });
      nexusBoundary = {
        timeSeconds: cue.timeSeconds,
        context: cue.context,
        exact,
        rewind,
      };
    }
    const dragonSeekClocks = [];
    if (scene.dragonKills?.length) {
      const dragonKills = player.getByLabel("Recorded dragon kills");
      assert.equal(scene.dragonKills.length, 5);
      await expect(dragonKills.getByRole("option")).toHaveCount(6);
      for (const event of [scene.dragonKills[0], scene.dragonKills.at(-1)]) {
        const champion = scene.participants.find(
          ({ participantId }) => participantId === event.actorContext,
        ).championName;
        const time = String(event.timeSeconds);
        await expect(
          dragonKills.getByRole("option", {
            name: `${champion} · ${event.timeSeconds.toFixed(3)} s`,
          }),
        ).toHaveAttribute("value", time);
        await dragonKills.selectOption(time);
        await expect(dragonKills).toHaveValue(time);
        await player.getByRole("button", { name: "Copy replay link" }).click();
        await expect
          .poll(async () =>
            new URL(
              await page.evaluate(() => navigator.clipboard.readText()),
            ).searchParams.get("t"),
          )
          .toBe(time);
        dragonSeekClocks.push(event.timeSeconds);
      }
      await page.screenshot({
        path: join(outputPath, `${name}-dragon-kills.png`),
        fullPage: true,
      });
    }
    const inhibitorSeekClocks = [];
    if (scene.inhibitorLosses !== undefined) {
      const inhibitorLosses = player.getByLabel("Recorded inhibitor losses", {
        exact: true,
      });
      const expectLossCount = (count) =>
        expect(
          player.getByText(`Recorded inhibitor losses ${count}`, {
            exact: true,
          }),
        ).toBeVisible();
      const events = scene.inhibitorLosses;
      if (events.length === 0) {
        await expect(inhibitorLosses).toHaveCount(0);
        await expectLossCount(0);
      } else {
        assert.equal(events.length, 3);
        await expect(inhibitorLosses.getByRole("option")).toHaveCount(4);
        assert.ok((await inhibitorLosses.boundingBox()).height >= 48);
        await scale.fill("0");
        await expectLossCount(0);
        for (const [event, count] of [
          [events[0], 1],
          [events.at(-1), events.length],
        ]) {
          const time = String(event.timeSeconds);
          await expect(
            inhibitorLosses.getByRole("option", {
              name: `${event.timeSeconds.toFixed(3)} s`,
            }),
          ).toHaveAttribute("value", time);
          await inhibitorLosses.selectOption(time);
          await expect(inhibitorLosses).toHaveValue(time);
          await expectLossCount(count);
          await player
            .getByRole("button", { name: "Copy replay link" })
            .click();
          const copiedUrl = () =>
            page.evaluate(() => navigator.clipboard.readText());
          await expect
            .poll(async () => new URL(await copiedUrl()).searchParams.get("t"))
            .toBe(time);
          await page.goto(await copiedUrl());
          await expect(inhibitorLosses).toHaveValue(time);
          await expectLossCount(count);
          inhibitorSeekClocks.push(event.timeSeconds);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          viewport.width,
        );
        await page.screenshot({
          path: join(outputPath, `${name}-inhibitor-losses.png`),
          fullPage: true,
        });
        await inhibitorLosses.selectOption(String(events[0].timeSeconds));
        await expectLossCount(1);
        await scale.fill("0");
        await expectLossCount(0);
      }
    }
    let playerBoundary = null;
    const teamScore = player.getByRole("region", {
      name: "Team kills",
      exact: true,
    });
    const matchResult = teamScore.locator("[data-match-result]");
    async function checkTeamScore(time, players) {
      const totals = [100, 200].map((team) => {
        const teamPlayers = players.filter(({ participantId }) =>
          scene.participants.some(
            (p) => p.participantId === participantId && p.teamId === team,
          ),
        );
        assert.equal(teamPlayers.length, 5);
        return teamPlayers.some(({ kills }) => kills === null)
          ? "—"
          : String(teamPlayers.reduce((sum, player) => sum + player.kills, 0));
      });
      await expect(teamScore.locator("dd")).toHaveText(totals);
      const finished = time === scene.identity.durationMilliseconds / 1000;
      if (finished) {
        assert.equal(scene.winningTeam, shortReplay ? 200 : 100);
        assert.deepEqual(totals, shortReplay ? ["0", "0"] : ["29", "23"]);
        await expect(matchResult).toHaveText(
          shortReplay ? "Red team wins" : "Blue team wins",
        );
      } else await expect(matchResult).toHaveCount(0);
    }
    let verifiedTeamScore = false;
    if (shortReplay) {
      const { checkpoints } = scene.playerState;
      assert.deepEqual(
        checkpoints.map(({ timeSeconds }) => timeSeconds),
        [0],
      );
      const scoreboard = player.getByRole("region", {
        name: "Replay scoreboard",
      });
      const alive = scoreboard.getByRole("cell", {
        name: "Alive",
        exact: true,
      });
      for (const time of [0, 70, 0]) {
        await scale.fill(String(time));
        await checkTeamScore(time, checkpoints[0].players);
        await expect(alive).toHaveCount(10);
        for (const {
          participantId,
          kills,
          deaths,
          assists,
          level,
          alive,
        } of checkpoints[0].players) {
          assert.deepEqual(
            [kills, deaths, assists, level, alive],
            [0, 0, 0, 1, true],
          );
          await expect(
            scoreboard
              .locator(`[data-participant-id="${participantId}"]`)
              .getByRole("cell"),
          ).toHaveText(["0", "0", "0", "1", "Alive"]);
        }
      }
      const end = new URL(url);
      const duration = scene.identity.durationMilliseconds / 1000;
      end.searchParams.set("t", String(duration));
      await page.goto(end.href);
      await expect(play).toBeVisible();
      await checkTeamScore(duration, checkpoints[0].players);
      await page.screenshot({
        path: join(outputPath, `${name}-team-result.png`),
        fullPage: true,
      });
      await scale.fill("0");
      await checkTeamScore(0, checkpoints[0].players);
      verifiedTeamScore = true;
    } else if (scene.playerState) {
      const { checkpoints } = scene.playerState;
      const deathIndex = checkpoints.findIndex(({ players }, index) => {
        const previous = checkpoints[index - 1]?.players;
        return previous?.some(
          (prior) =>
            prior.alive === true &&
            prior.deaths !== null &&
            players.some(
              (player) =>
                player.participantId === prior.participantId &&
                player.alive === false &&
                player.deaths === prior.deaths + 1,
            ),
        );
      });
      assert.ok(
        deathIndex > 0,
        "Expected a recorded KDA and alive-state change",
      );
      const { timeSeconds, players } = checkpoints[deathIndex];
      assert.equal(timeSeconds, 79.45458999633789);
      const previous = checkpoints[deathIndex - 1].players;
      const victim = players.find(
        ({ participantId, alive, deaths }) =>
          alive === false &&
          previous.some(
            (prior) =>
              prior.participantId === participantId &&
              prior.alive === true &&
              prior.deaths !== null &&
              deaths === prior.deaths + 1,
          ),
      );
      assert.equal(
        scene.participants.find(
          ({ participantId }) => participantId === victim.participantId,
        ).championName,
        "Renekton",
      );
      const returnCheckpoint = checkpoints
        .slice(deathIndex + 1)
        .find(({ players }) =>
          players.some(
            ({ participantId, alive }) =>
              participantId === victim.participantId && alive === true,
          ),
        );
      assert.ok(returnCheckpoint, "Expected the recorded return of the victim");
      const scoreboard = player.getByRole("region", {
        name: "Replay scoreboard",
      });
      await expect(scoreboard.getByRole("table")).toHaveCount(2);
      const checkPlayers = async (time, screenshot) => {
        const checkpoint = checkpoints.findLast(
          ({ timeSeconds }) => timeSeconds <= time,
        );
        await checkTeamScore(time, checkpoint.players);
        for (const stats of checkpoint.players) {
          const participant = scene.participants.find(
            ({ participantId }) => participantId === stats.participantId,
          );
          const row = scoreboard.locator(
            `[data-participant-id="${stats.participantId}"]`,
          );
          await expect(row.getByRole("rowheader")).toHaveText(
            participant.championName,
          );
          await expect(row.getByRole("cell")).toHaveText([
            ...[stats.kills, stats.deaths, stats.assists, stats.level].map(
              (value) => (value === null ? "—" : String(value)),
            ),
            stats.alive === null ? "—" : stats.alive ? "Alive" : "Dead",
          ]);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          viewport.width,
        );
        if (screenshot)
          await page.screenshot({
            path: join(outputPath, `${name}-scoreboard-${screenshot}.png`),
            fullPage: true,
          });
      };
      const before = (Math.ceil(timeSeconds * 10) - 1) / 10;
      const after = Math.ceil(timeSeconds * 10) / 10;
      const returned = Math.ceil(returnCheckpoint.timeSeconds * 10) / 10;
      for (const [time, screenshot] of [
        [before, "before-kill"],
        [after, "after-kill"],
        [returned, "return"],
        [before, null],
      ]) {
        await scale.fill(String(time));
        await checkPlayers(time, screenshot);
      }
      const exactUrl = new URL(url);
      exactUrl.searchParams.set("t", String(timeSeconds));
      await page.goto(exactUrl.href);
      await expect(play).toBeVisible();
      await checkPlayers(timeSeconds, null);
      await scale.fill(String(before - 1));
      await player.getByLabel("Speed").selectOption("1");
      const victimRow = scoreboard.locator(
        `[data-participant-id="${victim.participantId}"]`,
      );
      await expect(
        victimRow.getByRole("cell", { name: "Alive", exact: true }),
      ).toBeVisible();
      await play.click();
      await expect(
        victimRow.getByRole("cell", { name: "Dead", exact: true }),
      ).toBeVisible();
      await player.getByRole("button", { name: "Pause", exact: true }).click();
      const final = checkpoints.at(-1);
      const finalVictim = final.players.find(
        ({ participantId }) => participantId === victim.participantId,
      );
      assert.deepEqual(
        [
          finalVictim.kills,
          finalVictim.deaths,
          finalVictim.assists,
          finalVictim.level,
        ],
        [5, 6, 5, 17],
      );
      exactUrl.searchParams.set(
        "t",
        String(scene.identity.durationMilliseconds / 1000),
      );
      await page.goto(exactUrl.href);
      await expect(play).toBeVisible();
      await checkPlayers(scene.identity.durationMilliseconds / 1000, "end");
      await scale.fill("0");
      await checkPlayers(0, null);
      verifiedTeamScore = true;
      playerBoundary = {
        participantId: victim.participantId,
        before,
        exact: timeSeconds,
        after,
        returned,
        rewound: before,
        playsAcrossDeath: true,
        footerKdaAndLevel: [5, 6, 5, 17],
      };
    }
    let decodedPositionCoverage;
    if (scene.decodedPositionFrames !== undefined) {
      await page.goto(url.href);
      await expect(play).toBeVisible();
      const selector = player.getByLabel("Decoded champion positions", {
        exact: true,
      });
      const decoded = scene.decodedPositionFrames;
      assert.equal(decoded.length, shortReplay ? 2 : 30);
      await expect(selector.getByRole("option")).toHaveCount(
        decoded.length + 1,
      );
      assert.ok((await selector.boundingBox()).height >= 48);
      let markerCount = 0;
      const checkFrame = async ({ timeSeconds, markers }) => {
        await expect(
          player.getByText(
            `${markers.length} decoded champion positions at ${timeSeconds.toFixed(3)} s.`,
            { exact: true },
          ),
        ).toBeVisible();
        const draw = await readDraw();
        assertActorDraws(draw, markers);
        assertStructures(draw, timeSeconds);
      };
      for (const frame of decoded) {
        await selector.selectOption(String(frame.timeSeconds));
        await checkFrame(frame);
        markerCount += frame.markers.length;
      }
      assert.equal(markerCount, shortReplay ? 20 : 267);
      const late = decoded.at(-1);
      await player.getByRole("button", { name: "Copy replay link" }).click();
      await expect(player.getByText("Replay link copied.")).toBeVisible();
      const decodedUrl = new URL(
        await page.evaluate(() => navigator.clipboard.readText()),
      );
      assert.equal(decodedUrl.searchParams.get("t"), String(late.timeSeconds));
      await page.goto(decodedUrl.href);
      await checkFrame(late);
      await page.screenshot({
        path: join(outputPath, `${name}-decoded-champion-positions.png`),
        fullPage: true,
      });
      await selector.selectOption(String(decoded[0].timeSeconds));
      await checkFrame(decoded[0]);
      if (scene.motion === undefined) {
        await scale.fill("5");
        await expect(
          player.getByText("No positions at this replay time."),
        ).toBeVisible();
        assert.equal((await readDraw()).markerCount, 0);
      }
      decodedPositionCoverage = { keyframes: decoded.length, markerCount };
    }
    let movementPlayback;
    if (scene.motion !== undefined) {
      const heights = await (
        await page.request.get(new URL("/heights.bin", url).href)
      ).body();
      const groundHeight = createNavgridGroundHeight(
        scene.mapBounds,
        scene.navgrid,
        new Float32Array(
          heights.buffer.slice(
            heights.byteOffset,
            heights.byteOffset + heights.byteLength,
          ),
        ),
      );
      const teams = new Map(
        scene.participants.map(({ participantId, teamId }) => [
          participantId,
          teamId,
        ]),
      );
      const exact = new Map(
        (scene.decodedPositionFrames ?? []).map((frame) => [
          frame.timeSeconds,
          frame.markers,
        ]),
      );
      for (const frame of recorded) exact.set(frame.timeSeconds, frame.markers);
      const markersAt = (time) =>
        exact.get(time) ??
        sampleNativeTerrainMotion(scene.motion, time).markers.flatMap(
          ({ participantId, x, z, moving }) => {
            const y = groundHeight(x, z);
            return y === null
              ? []
              : [
                  {
                    participantId,
                    teamId: teams.get(participantId),
                    position: [x, y, z],
                    moving,
                  },
                ];
          },
        );
      const ranges = [];
      const duration = scene.identity.durationMilliseconds / 1000;
      for (const offset of [0, 0.4, 0.8]) {
        for (
          let second = Math.floor(duration * offset) + 5;
          second + 0.6 <= duration && second < duration * (offset + 0.2);
          second += 1
        ) {
          const start = second + 0.1;
          const end = second + 0.6;
          if (exact.has(start) || exact.has(end)) continue;
          const first = markersAt(start);
          const last = markersAt(end);
          const moving = first.find((marker) => {
            const counterpart = last.find(
              ({ participantId }) => marker.participantId === participantId,
            );
            return (
              marker.moving &&
              counterpart?.moving &&
              Math.hypot(
                marker.position[0] - counterpart.position[0],
                marker.position[2] - counterpart.position[2],
              ) > 10
            );
          });
          if (!moving) continue;
          ranges.push({ start, end, participantId: moving.participantId });
          break;
        }
      }
      assert.equal(
        ranges.length,
        3,
        "Expected movement at early, middle, and late clocks",
      );
      for (const { start, end, participantId } of ranges) {
        await scale.fill(String(start));
        await expect(
          player.getByText(/champion positions from replay movement data/),
        ).toBeVisible();
        assert.deepEqual(
          (await readDraw()).markerVertices,
          vertexArray(markersAt(start)),
        );
        await checkMapDots(markersAt(start));
        const free = await readDraw();
        await camera.selectOption(`player:${participantId}`);
        const followed = await readDraw();
        assert.notDeepEqual(followed.matrix, free.matrix);
        await scale.fill(String(end));
        const destination = await readDraw();
        assert.deepEqual(
          destination.markerVertices,
          vertexArray(markersAt(end)),
        );
        assert.notDeepEqual(destination.matrix, followed.matrix);
        await scale.fill(String(start));
        assert.deepEqual((await readDraw()).matrix, followed.matrix);
        assert.deepEqual(
          (await readDraw()).markerVertices,
          followed.markerVertices,
        );
        await camera.selectOption({ label: "Free camera" });
        await scale.fill(String(end));
        await checkMapDots(markersAt(end));
      }
      if (playerBoundary !== null) {
        const { participantId, before, exact, after, returned } =
          playerBoundary;
        const hasVictim = (time) =>
          markersAt(time).some(
            (marker) => marker.participantId === participantId,
          );
        const returnedMarkerTime = Array.from(
          { length: 100 },
          (_, i) => (Math.round(returned * 10) + i) / 10,
        ).find(hasVictim);
        assert.equal(hasVictim(before), true);
        assert.equal(hasVictim(exact), false);
        assert.equal(hasVictim(after), false);
        assert.ok(
          returnedMarkerTime !== undefined,
          "Expected a new position after the recorded return",
        );
        const exactUrl = new URL(url);
        exactUrl.searchParams.set("t", String(exact));
        exactUrl.searchParams.set("follow", String(participantId));
        await page.goto(exactUrl.href);
        await expect(camera).toHaveValue(`player:${participantId}`);
        const missing = await readDraw();
        assert.deepEqual(missing.markerVertices, vertexArray(markersAt(exact)));
        await camera.selectOption("free");
        assert.deepEqual((await readDraw()).matrix, missing.matrix);
        await camera.selectOption(`player:${participantId}`);
        for (const time of [after, returnedMarkerTime, before]) {
          await scale.fill(String(time));
          assert.deepEqual(
            (await readDraw()).markerVertices,
            vertexArray(markersAt(time)),
          );
          const followed = await readDraw();
          if (hasVictim(time))
            assert.notDeepEqual(followed.matrix, missing.matrix);
          else assert.deepEqual(followed.matrix, missing.matrix);
        }
        playerBoundary.returnedMarkerTime = returnedMarkerTime;
      }
      const { start, end, participantId } = ranges[0];
      await scale.fill(String(start));
      await camera.selectOption(`player:${participantId}`);
      await player.getByLabel("Speed").selectOption("0.5");
      const pausedDraw = await readDraw();
      await page.evaluate(() => {
        window.scoutTerrainCheck.movementFrames = [];
      });
      await play.click();
      await expect
        .poll(async () => Number(await scale.inputValue()))
        .toBeGreaterThanOrEqual(end);
      await player.getByRole("button", { name: "Pause", exact: true }).click();
      const playedDraw = await readDraw();
      assert.ok(playedDraw.markerCount > 0);
      assert.notDeepEqual(playedDraw.markerVertices, pausedDraw.markerVertices);
      assert.notDeepEqual(playedDraw.matrix, pausedDraw.matrix);
      const distinctGeometry = new Set(
        playedDraw.movementFrames.map(({ vertices }) =>
          JSON.stringify(vertices),
        ),
      ).size;
      const distinctViews = new Set(
        playedDraw.movementFrames.map(({ matrix }) => JSON.stringify(matrix)),
      ).size;
      assert.ok(
        distinctGeometry >= 3,
        "Expected multiple rendered positions during playback",
      );
      assert.ok(
        distinctViews >= 3,
        "Expected multiple followed camera views during playback",
      );
      const midMatch = ranges[1];
      await scale.fill(String(midMatch.end));
      await camera.selectOption(`player:${midMatch.participantId}`);
      if (modelProof) {
        const close = player.getByRole("button", {
          name: "Close-up follow",
        });
        const wideView = (await readDraw()).matrix;
        await close.click();
        await expect(close).toHaveAttribute("aria-pressed", "true");
        const draw = await readDraw();
        assert.notDeepEqual(draw.matrix, wideView);
        assertActorDraws(draw, markersAt(midMatch.end));
      }
      await page.screenshot({
        path: join(outputPath, `${name}-champion-movement.png`),
        fullPage: true,
      });
      movementPlayback = {
        checkedRanges: ranges,
        playbackVertices: distinctGeometry,
        playbackMatrices: distinctViews,
      };
    }
    assert.deepEqual(errors, []);
    summaries.push({
      name,
      verifiedMarkers,
      recordedClocks: recorded.length,
      markersInGap,
      decodedPositionCoverage,
      movementPlayback,
      usedMotionWorker,
      terrainMaterialCoverage,
      championModelCoverage: modelProof && {
        models: modelProof.size,
        submeshes: [...modelProof.values()].reduce(
          (total, { draws }) => total + draws.length,
          0,
        ),
        triangles: [...modelProof.values()].reduce(
          (total, { draws }) =>
            total + draws.reduce((sum, count) => sum + count, 0) / 3,
          0,
        ),
      },
      structureModelCoverage: structureProof && {
        models: structureProof.size,
        placed: scene.structureModels.instances.length,
        losses: scene.turretLosses.length,
      },
      freeCameraPan: scene.minimap === true,
      liveMinimapPositions:
        scene.minimap === true && scene.motion !== undefined,
      canvas: [canvas.width, canvas.height],
      followAndExactShareRestored: true,
      turretBoundary,
      turretSeekClock,
      nexusBoundary,
      dragonSeekClocks,
      inhibitorSeekClocks,
      playerBoundary,
      verifiedTeamScore,
    });
    await page.close();
  }
  await writeFile(
    join(outputPath, "scout-verification.json"),
    JSON.stringify(summaries, null, 2),
  );
  console.log(JSON.stringify(summaries, null, 2));
} finally {
  await browser.close();
}
