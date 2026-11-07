import { test, expect } from "bun:test";
import { resolve } from "node:path";
import * as THREE from "../../../../.cache/replay-spike/public/vendor/three.core.js";

test("actual shared retained geometry invalidates cached sort bounds after positions move", async () => {
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "latest-trail-renderer.mjs")],
    target: "bun",
    write: false,
    external: ["/assets/*"],
    plugins: [
      {
        name: "pinned-three",
        setup(build) {
          build.onResolve({ filter: /^three$/ }, () => ({
            path: resolve(
              import.meta.dir,
              "../../../../.cache/replay-spike/public/vendor/three.module.js",
            ),
          }));
        },
      },
    ],
  });
  if (!build.success) throw Error(build.logs.map(String).join("\n"));
  const { LatestTrailVfxRenderer } = await import(
    `data:text/javascript;base64,${Buffer.from(await build.outputs[0].text()).toString("base64")}`
  );
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  mesh.frustumCulled = false;
  const adapter = { decodeGeometry: (draw) => draw };
  const draw = (z) => ({
    a_POSITION: new Float32Array([-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z]),
    a_COLOR: new Uint8Array(16),
    a_TEXCOORD: new Uint16Array(16),
    a_TEXCOORD1: new Uint16Array(8),
    index: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
  const apply = (value) =>
    LatestTrailVfxRenderer.prototype.applyGeometry.call(adapter, mesh, value);
  apply(draw(5));
  // Translated shaders use a_POSITION. THREE's automatic bounds do not inspect
  // that name, so establish an actual bounds cache explicitly from its bytes.
  mesh.geometry.computeBoundingSphere();
  expect(mesh.geometry.boundingSphere.center.z).toBe(0);
  const computeActualBounds = () => {
    mesh.geometry.boundingSphere = new THREE.Box3()
      .setFromArray(mesh.geometry.attributes.a_POSITION.array)
      .getBoundingSphere(new THREE.Sphere());
  };
  computeActualBounds();
  expect(mesh.geometry.boundingSphere.center.z).toBe(5);
  const retained = mesh.geometry,
    positions = retained.attributes.a_POSITION.array;
  const next = draw(20);
  apply(next);
  expect(mesh.geometry).toBe(retained);
  expect(retained.attributes.a_POSITION.array).toBe(positions);
  expect(Array.from(positions)).toEqual(Array.from(next.a_POSITION));
  expect(retained.boundingSphere).toBeNull();
  computeActualBounds();
  expect(mesh.geometry.boundingSphere.center.z).toBe(20);
  apply(draw(5));
  expect(mesh.geometry.boundingSphere).toBeNull();
  computeActualBounds();
  expect(mesh.geometry.boundingSphere.center.z).toBe(5);
});
