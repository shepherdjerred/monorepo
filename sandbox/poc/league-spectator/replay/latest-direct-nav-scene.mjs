import { sha256 } from "./structural-comparison.mjs";
import { DirectNavmeshProducer } from "./latest-direct-navmesh-producer.mjs";
import { directNavgridTransform } from "./latest-direct-navgrid-transform.mjs";
import {
  DIRECT_NAV_SCENE_POLICY,
  DIRECT_NAV_SCENE_PACKAGE_SHA,
  DIRECT_NAV_SCENE_OMISSIONS,
  DIRECT_NAV_RECORDED_STATE_REQUIREMENTS,
} from "./latest-direct-nav-scene-contract.mjs";

const owned = new WeakSet(),
  copy = structuredClone;
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exact = (v, keys) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Reflect.ownKeys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const decode = (bytes) => {
  if (!(bytes instanceof Uint8Array))
    throw Error("Owned nav source bytes required");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};
const vector3 = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  [0, 1, 2].every(
    (i) =>
      Object.hasOwn(v, i) &&
      typeof v[i] === "number" &&
      Number.isFinite(Math.fround(v[i])),
  );

// Structural validation is separate from package-hash admission so rejection
// cases can exercise each invariant. Only the async factory mints owned views.
export function validateDirectNavSceneSource(source, scene, sceneSha256) {
  if (
    !exact(source, [
      "schema",
      "kind",
      "build",
      "protocol",
      "sceneManifestSha256",
      "selectedMap",
      "navigation",
      "proofs",
    ]) ||
    source.schema !== 1 ||
    source.kind !== "prepared-original-initial-nav-scene" ||
    source.build !== "16.21.829.8620" ||
    source.protocol !== "20e09df23c66b85e" ||
    source.build !== scene?.build ||
    source.protocol !== scene?.protocol ||
    scene.schema !== 1 ||
    !digest(sceneSha256) ||
    source.sceneManifestSha256 !== sceneSha256 ||
    !exact(source.selectedMap, ["id", "variant", "selection", "navPath"]) ||
    !Number.isInteger(source.selectedMap.id) ||
    source.selectedMap.id < 0 ||
    typeof source.selectedMap.variant !== "string" ||
    !source.selectedMap.variant ||
    typeof source.selectedMap.selection !== "string" ||
    !source.selectedMap.selection ||
    typeof source.selectedMap.navPath !== "string" ||
    !source.selectedMap.navPath ||
    !same(
      source.selectedMap,
      Object.fromEntries(
        ["id", "variant", "selection", "navPath"].map((k) => [
          k,
          scene.map?.[k],
        ]),
      ),
    )
  )
    throw Error(
      "Navigation source must match the exact selected scene and build",
    );
  const n = source.navigation;
  if (
    !exact(n, [
      "sourceSha256",
      "width",
      "height",
      "rgbaHex",
      "rgbaSha256",
      "cellFlagsHex",
      "cellSize",
      "origin",
      "center",
      "extent",
      "transformHex",
    ]) ||
    !digest(n.sourceSha256) ||
    n.sourceSha256 !== scene.map?.heightGrid?.sourceSha256 ||
    !Number.isInteger(n.width) ||
    n.width < 2 ||
    n.width > 1024 ||
    !Number.isInteger(n.height) ||
    n.height < 2 ||
    n.height > 1024 ||
    !Number.isFinite(n.cellSize) ||
    !(Math.fround(n.cellSize) > 0) ||
    !vector3(n.origin) ||
    !vector3(n.center) ||
    !vector3(n.extent) ||
    !digest(n.rgbaSha256) ||
    typeof n.rgbaHex !== "string" ||
    n.rgbaHex.length !== n.width * n.height * 8 ||
    !/^[a-f0-9]+$/.test(n.rgbaHex) ||
    typeof n.cellFlagsHex !== "string" ||
    n.cellFlagsHex.length !== n.width * n.height * 4 ||
    !/^[a-f0-9]+$/.test(n.cellFlagsHex) ||
    typeof n.transformHex !== "string" ||
    !/^[a-f0-9]{32}$/.test(n.transformHex)
  )
    throw Error(
      "Complete installed navigation source identity and scalar surface required",
    );
  const f = Math.fround,
    extent = [f(n.width * f(n.cellSize)), 0, f(n.height * f(n.cellSize))],
    center = [
      f(f(extent[0] * f(0.5)) + f(n.origin[0])),
      f(n.origin[1]),
      f(f(extent[2] * f(0.5)) + f(n.origin[2])),
    ],
    transform = directNavgridTransform({ center, extent }),
    flags = new DataView(Uint8Array.fromHex(n.cellFlagsHex).buffer),
    rgba = Uint8Array.fromHex(n.rgbaHex);
  if (
    !same(n.extent, extent) ||
    !same(n.center, center) ||
    new Uint8Array(transform.buffer).toHex() !== n.transformHex
  )
    throw Error(
      "Navigation transform must derive from the same cell-grid source",
    );
  for (let i = 0; i < n.width * n.height; i++) {
    const blue = (flags.getUint16(i * 2, true) & 0xc02) === 2 ? 0 : 255;
    if (
      rgba[i * 4] !== blue ||
      rgba[i * 4 + 1] !== blue ||
      rgba[i * 4 + 2] !== blue ||
      rgba[i * 4 + 3] !== 255
    )
      throw Error(
        "Initial navigation RGBA differs from original cell-flag initialization",
      );
  }
  if (
    !exact(source.proofs, [
      "sourceNativeSha256",
      "sourceComparisonSha256",
      "producerComparisonSha256",
      "producerGpuReplaySha256",
    ]) ||
    !Object.values(source.proofs).every(digest)
  )
    throw Error(
      "Exact navigation source and producer proof identities required",
    );
  return { rgba, transform };
}

export const isLatestDirectNavScene = (v) =>
  v !== null && typeof v === "object" && owned.has(v);

export async function createDirectNavScene({
  sceneManifestBytes,
  sourcePackageBytes,
  expectedPackageSha256,
  policy,
}) {
  if (policy !== DIRECT_NAV_SCENE_POLICY)
    throw Error(
      "Explicit partial installed-navigation presentation policy required",
    );
  if (
    !digest(expectedPackageSha256) ||
    (await sha256(sourcePackageBytes)) !== expectedPackageSha256
  )
    throw Error("Pinned initial-navigation package changed");
  const scene = decode(sceneManifestBytes),
    source = decode(sourcePackageBytes),
    sceneSha256 = await sha256(sceneManifestBytes),
    { rgba, transform } = validateDirectNavSceneSource(
      source,
      scene,
      sceneSha256,
    );
  if ((await sha256(rgba)) !== source.navigation.rgbaSha256)
    throw Error("Initial navigation surface hash differs");
  const producer = new DirectNavmeshProducer({
      width: source.navigation.width,
      height: source.navigation.height,
      highResolution: true,
    }),
    resources = producer.resources(),
    // This is a declared presentation epoch. No recovered native game clock is claimed.
    initialization = producer.update({
      now: 0,
      rgba,
      dirty: true,
      force: false,
      modeUpdatesEnabled: true,
    }),
    frames = new WeakMap();
  let sequence = 0;
  const metadata = Object.freeze({
    schema: 1,
    policy,
    sourcePackageSha256: expectedPackageSha256,
    sceneManifestSha256: sceneSha256,
    navigationSourceSha256: source.navigation.sourceSha256,
    map: copy(source.selectedMap),
    width: resources.width,
    height: resources.height,
    omissions: [...DIRECT_NAV_SCENE_OMISSIONS],
    scope: {
      initialInstalledNavigationOnly: true,
      decodedMapVariantRecovered: false,
      dynamicMutationsRecovered: false,
      nativeScenePublicationRecovered: false,
      producerCommandsAreRenderedCoverage: false,
    },
  });
  const view = Object.freeze({
    inspect: () => copy(metadata),
    initialization: () => ({
      resources: copy(resources),
      plan: copy(initialization),
    }),
    frame({ time }) {
      if (
        typeof time !== "number" ||
        time < 0 ||
        !Number.isFinite(time) ||
        !Number.isFinite(Math.fround(time))
      )
        throw Error(
          "Explicit nonnegative replay time required for navigation frame",
        );
      const token = Object.freeze({});
      frames.set(token, {
        sequence: ++sequence,
        replayTime: time,
        producerTime: Math.fround(time),
        plan: producer.update({
          now: time,
          rgba,
          dirty: false,
          force: false,
          modeUpdatesEnabled: true,
        }),
        transformBytes: new Uint8Array(transform.buffer).slice(),
        metadata,
      });
      return token;
    },
    inspectFrame(token) {
      const frame = frames.get(token);
      if (!frame)
        throw Error("Navigation frame belongs to another scene or is forged");
      return copy(frame);
    },
    recordedStateRequirements: () => [
      ...DIRECT_NAV_RECORDED_STATE_REQUIREMENTS,
    ],
  });
  owned.add(view);
  return view;
}

export function createLatestDirectNavScene({
  sceneManifestBytes,
  sourcePackageBytes,
  policy,
}) {
  return createDirectNavScene({
    sceneManifestBytes,
    sourcePackageBytes,
    policy,
    expectedPackageSha256: DIRECT_NAV_SCENE_PACKAGE_SHA,
  });
}
