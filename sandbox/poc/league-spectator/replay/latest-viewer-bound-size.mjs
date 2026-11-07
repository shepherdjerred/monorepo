import { sha256 } from "./structural-comparison.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { sameDirectCompiledData } from "./latest-direct-compiled-restore.mjs";
export const VIEWER_BOUND_SIZE_POLICY =
  "same-viewer-single-model-resource-bound-size-partial-v1";
const f = Math.fround,
  maximum = f(3.4028234663852886e38);
// MAXSS(-value,value) chooses its source operand on equal zero.
const nativeMagnitude = (value) => (value < 0 ? -value : value);
const finite = (value) =>
  typeof value === "number" && Number.isFinite(f(value));
const vector = (value, count) =>
  Array.isArray(value) &&
  value.length === count &&
  Array.from(value).every(finite);
const blocks = [
  [
    0x184cc10,
    372,
    "992ccbf6c6622f2ba4d57f2c5a0633a875130cdcb93d8a68236ec82fe44252e4",
  ],
  [
    0x1863730,
    59,
    "9a7fc06fbb602db3aef880333b017d6c9982bdafc6f148e53909a9fb71a31585",
  ],
  [
    0x1874fa0,
    307,
    "98118c9e4afc6731a4779d07b586673960ca22f5e1494ae27795df0d41843e61",
  ],
  [
    0x36ad54,
    149,
    "b03f7a4ea5ccb250d1cabcf264236415c5ae4ec89d69b4a764e63d4450b2ae2b",
  ],
  [
    0xc1320,
    505,
    "a23471cefa7ba61169380208e91e8be904a81313cb1ae618abc3ba6450ccb953",
  ],
  [
    0x5492e0,
    406,
    "ee967c342239ac246d64c7cefa483b701f76cd57bea1164118deff5226a0f0d6",
  ],
  [
    0x1853e60,
    464,
    "2b47c32d413e600acd406e2f57c602d86f43b7a9c26a28c5c56e00b32c1247d3",
  ],
  [
    0x1853ac5,
    35,
    "8722b840217d3d9dcdc8a3d13986f59ad980a8ece591fdd7c3a3851d56fd156e",
  ],
];
function authored(object, name, hash) {
  const alias = `{${hash}}`;
  if (Object.hasOwn(object, name) && Object.hasOwn(object, alias))
    throw Error("Ambiguous authored bound field");
  return Object.hasOwn(object, name) ? object[name] : object[alias];
}
export function deriveLatestViewerResourceBounds(skn, properties) {
  if (
    !(skn instanceof Uint8Array) ||
    skn.byteLength < 12 ||
    properties?.__type !== "SkinMeshDataProperties"
  )
    throw Error("Owned installed SKN and skin properties required");
  const view = new DataView(skn.buffer, skn.byteOffset, skn.byteLength);
  if (view.getUint32(0, true) !== 0x112233) throw Error("Invalid SKN magic");
  if (view.getUint16(4, true) !== 4 || view.getUint16(6, true) !== 1)
    return {
      resolved: false,
      reasons: [
        `bound-size:unsupported-skn-version:${view.getUint16(4, true)}:${view.getUint16(6, true)}`,
      ],
    };
  const groups = view.getUint32(8, true),
    at = 12 + groups * 80;
  if (!groups || groups > 4096 || at + 60 > skn.length)
    throw Error("Invalid SKN group/header bounds");
  const flags = view.getUint32(at, true),
    indices = view.getUint32(at + 4, true),
    vertices = view.getUint32(at + 8, true),
    stride = view.getUint32(at + 12, true),
    format = view.getUint32(at + 16, true);
  if (
    flags !== 0 ||
    !indices ||
    !vertices ||
    vertices > 65536 ||
    ![52, 56, 72, 104].includes(stride) ||
    [52, 56, 72, 104][format] !== stride ||
    at + 60 + indices * 2 + vertices * stride + 12 !== skn.length ||
    skn.subarray(-12).some((x) => x !== 0)
  )
    throw Error("Unestablished or corrupt SKN4.1 layout");
  const mesh = Array.from({ length: 6 }, (_, i) =>
    view.getFloat32(at + 20 + i * 4, true),
  );
  if (!vector(mesh, 6) || mesh.slice(0, 3).some((x, i) => x > mesh[i + 3]))
    throw Error("Invalid installed mesh bounds");
  const suppliedBox = authored(properties, "overrideBoundingBox", "5c7a0332"),
    suppliedRadius = authored(properties, "boundingSphereRadius", "96169cd6"),
    scale = authored(properties, "skinScale", "a1f805da");
  if (suppliedBox !== undefined && !vector(suppliedBox, 3))
    throw Error("Finite authored bounding box required");
  if (suppliedRadius !== undefined && !finite(suppliedRadius))
    throw Error("Finite authored sphere radius required");
  if (scale !== undefined && (!finite(scale) || scale <= 0))
    throw Error("Positive authored model scale required");
  const box =
    suppliedBox !== undefined && f(suppliedBox[0]) !== maximum
      ? suppliedBox.map(f)
      : [
          nativeMagnitude(f(mesh[3] - mesh[0])),
          f(mesh[4] - mesh[1]),
          nativeMagnitude(f(mesh[5] - mesh[2])),
        ];
  if (box.some((x) => x < 0))
    throw Error("Nonnegative installed resource extents required");
  return {
    resolved: true,
    resourceBounds: [
      0,
      mesh[1],
      0,
      f(box[0] + 0),
      f(box[1] + mesh[1]),
      f(box[2] + 0),
    ],
    sphereRadius:
      suppliedRadius === undefined || f(suppliedRadius) === maximum
        ? -maximum
        : f(suppliedRadius),
    modelScale: f(scale ?? 1),
  };
}
export function sampleLatestViewerResourceBoundSize(resource, position) {
  if (
    !resource?.resolved ||
    !vector(resource.resourceBounds, 6) ||
    !finite(resource.sphereRadius) ||
    !finite(resource.modelScale) ||
    resource.modelScale <= 0 ||
    !vector(position, 3)
  )
    throw Error("Verified resource bounds and viewer root required");
  if (resource.sphereRadius >= 0)
    return {
      boundObjectSize: resource.sphereRadius,
      cachedAabb: null,
      source: "original-resource-sphere-radius",
    };
  const b = resource.resourceBounds,
    p = position.map(f),
    scale = f(resource.modelScale),
    x = f(b[3] - b[0]),
    y = f(b[4] - b[1]),
    z = f(b[5] - b[2]);
  // Original AI single-model cached bounds average horizontal extents, apply
  // model scale, then publish at the supplied root. Preserve each f32 step.
  const width = f(f(f(x + z) * f(0.5)) * scale),
    height = f(y * scale),
    half = f(width * f(0.5));
  const minimum = [f(p[0] - half), f(p[1] + b[1]), f(p[2] - half)];
  const maximum = [
    f(minimum[0] + width),
    f(minimum[1] + height),
    f(minimum[2] + width),
  ];
  const delta = maximum.map((v, i) => f(v - minimum[i]));
  const squared = f(
    f(f(delta[0] * delta[0]) + f(delta[1] * delta[1])) + f(delta[2] * delta[2]),
  );
  return {
    boundObjectSize: f(Math.sqrt(squared)),
    cachedAabb: [...minimum, ...maximum],
    source: "original-ai-single-model-cached-aabb-diagonal",
  };
}
export function resolveLatestViewerBoundSizePlacement(
  placement,
  { event, time, cursor, world },
  definition,
) {
  if (
    !placement.resolved ||
    !event.descriptor?.attachmentEntityId ||
    !definition?.emitters.some(
      (e) => e.placementRequirements?.boundObjectSize === "finite-nonnegative",
    )
  )
    return placement;
  if (typeof world.viewerBoundSize !== "function")
    throw Error("Owned time-addressed viewer bound-size service required");
  const size = world.viewerBoundSize(
    event.descriptor.attachmentEntityId,
    time,
    cursor,
  );
  if (size.policy !== VIEWER_BOUND_SIZE_POLICY)
    throw Error("Viewer bound-size policy differs");
  if (!size.resolved)
    return {
      ...placement,
      reasons: [
        ...(placement.reasons ?? []),
        ...size.reasons.map((r) => `world:${r}`),
      ],
    };
  if (
    size.entityId !== event.descriptor.attachmentEntityId ||
    !finite(size.boundObjectSize) ||
    size.boundObjectSize < 0
  )
    throw Error("Exact attached bound owner/size required");
  return {
    ...placement,
    boundObjectSize: f(size.boundObjectSize),
    boundObjectSizeStatus: VIEWER_BOUND_SIZE_POLICY,
    boundObjectSizeEvidence: size,
    reasons: [
      ...(placement.reasons ?? []).filter(
        (r) => r !== "world:attached-bound-object-size-unknown",
      ),
      ...size.omissions,
    ],
  };
}
export async function createLatestViewerBoundSizeResources({
  staticCatalog,
  profile,
  scene,
  image,
  read,
}) {
  assertLatestStaticCatalogSelection(staticCatalog);
  if (
    !sameDirectCompiledData(profile, staticCatalog.profile()) ||
    profile.clientVersion !== "16.21.829.8620" ||
    profile.decoderImageSha256 !==
      "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" ||
    !(image instanceof Uint8Array)
  )
    throw Error("Selected exact-build bound resource inputs required");
  if (
    !sameDirectCompiledData(
      scene,
      JSON.parse(
        new TextDecoder().decode(await staticCatalog.readRole("scene")),
      ),
    )
  )
    throw Error("Bound resource selected scene differs");
  for (const [rva, size, digest] of blocks)
    if ((await sha256(image.subarray(rva, rva + size))) !== digest)
      throw Error("Original bound resource instructions differ");
  const resources = new Map();
  for (const [key, asset] of Object.entries(scene.champions)) {
    const skinPath = `latest-scene/${asset.skinDefinition}`,
      sknPath = `latest-scene/${asset.model.slice(0, asset.model.lastIndexOf("/"))}/model.skn`;
    const skinBytes = await read(skinPath),
      skn = await read(sknPath);
    if (
      !sameDirectCompiledData(skinBytes, await staticCatalog.read(skinPath)) ||
      !sameDirectCompiledData(skn, await staticCatalog.read(sknPath))
    )
      throw Error("Bound resource bytes differ from owned selected inventory");
    const skin = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(skinBytes),
      ),
      properties =
        skin[`Characters/${asset.champion}/Skins/Skin${asset.skinId}`]
          ?.skinMeshProperties;
    const resource = deriveLatestViewerResourceBounds(skn, properties);
    if (resource.resolved && !Object.is(resource.modelScale, f(asset.scale)))
      throw Error("Viewer scale differs from owned installed skin");
    resources.set(key, {
      ...resource,
      staticEvidence: {
        skinPath,
        skinSha256: await sha256(skinBytes),
        sknPath,
        sknSha256: await sha256(skn),
      },
    });
  }
  return Object.freeze({
    sample(key, position) {
      const resource = resources.get(key);
      if (!resource) throw Error("Selected viewer bound actor unavailable");
      return resource.resolved
        ? {
            ...sampleLatestViewerResourceBoundSize(resource, position),
            staticEvidence: structuredClone(resource.staticEvidence),
          }
        : structuredClone(resource);
    },
  });
}
