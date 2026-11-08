import { NativeVfxSpawnKernel, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { sha256 } from "./structural-comparison.mjs";

const owned = {
    rig: 0x10040000,
    rows: 0x10041000,
    pose: 0x10049000,
    poses: 0x10050000,
    parents: 0x10060000,
    root: 0x10090000,
    canary: 0x10091000,
  },
  blocks = [
    [0x15bc970, 0x15bd0c0],
    [0x15bd0c0, 0x15bd300],
    [0x15852a0, 0x1585440],
    [0x15bdea0, 0x15bdf60],
    [0x1499680, 0x1499870],
    [0xd3ca0, 0xd4050],
  ],
  hex = (raw) =>
    Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
function transform(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{80}$/.test(value))
    throw Error("Invalid local/root pose transform");
  const bytes = Uint8Array.from(value.match(/../g), (b) => parseInt(b, 16)),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < 40; i += 4)
    if (!Number.isFinite(view.getFloat32(i, true)))
      throw Error("Non-finite local/root pose transform");
  return bytes;
}

// Original world-pose pass. Local samples and actor root placement remain inputs.
export async function createLatestAnimationWorldPoses(
  uc,
  profile,
  image,
  spawnBytes,
  definitionBytes,
) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(definitionBytes)) !== profile.animationWorldPosesSha256
  )
    throw Error("World-pose package hash mismatch");
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes)),
    spawn = JSON.parse(new TextDecoder().decode(spawnBytes)),
    imageBytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (
    meta.schema !== 1 ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    meta.animationRigsSha256 !== profile.animationRigsSha256 ||
    meta.animationPosesSha256 !== profile.animationPosesSha256 ||
    meta.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.constructorRva !== 0x15bc970 ||
    meta.worldPassRva !== 0x15852a0 ||
    meta.recursiveRva !== 0x15bdea0 ||
    meta.composeRva !== 0x1499680 ||
    JSON.stringify(meta.sourceBlocks.map((b) => [b.startRva, b.endRva])) !==
      JSON.stringify(blocks)
  )
    throw Error("Unsupported world-pose package");
  for (const b of meta.sourceBlocks)
    if ((await sha256(imageBytes.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("World-pose code changed");
  const k = new NativeVfxSpawnKernel(
      uc,
      profile,
      imageBytes,
      spawn,
      null,
      spawnPreviewMath,
    ),
    e = k.engine;
  let closed = false,
    poisoned = false;
  const ensure = () => {
      if (closed || poisoned) throw Error("Unavailable world-pose kernel");
    },
    u32 = (at, v) => {
      const raw = new Uint8Array(4);
      new DataView(raw.buffer).setUint32(0, v, true);
      e.mem_write(at, raw);
    };
  // Supply the external C canary storage while retaining the original check.
  k.u64(k.base + 0x22e0310, owned.canary);
  k.u64(owned.canary, 0x7766554433221100n);
  return {
    async bind(graphFile, rigBytes, catalogBytes) {
      ensure();
      const graph = meta.graphs[graphFile];
      if (
        !graph ||
        (await sha256(rigBytes)) !== graph.rigSha256 ||
        (await sha256(catalogBytes)) !== graph.catalogSha256
      )
        throw Error("World-pose rig/catalog mismatch");
      const catalog = JSON.parse(new TextDecoder().decode(catalogBytes)),
        n = graph.joints.length;
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        n > 256 ||
        JSON.stringify(catalog.joints) !== JSON.stringify(graph.joints) ||
        graph.parents.length !== n ||
        graph.jointIds.length !== n ||
        graph.jointIds.some((id, i) => id !== i)
      )
        throw Error("Unadmitted world-pose hierarchy");
      for (let i = 0; i < n; i++) {
        const seen = new Set();
        let at = i;
        while (at !== -1) {
          if (!Number.isInteger(at) || at < 0 || at >= n || seen.has(at))
            throw Error("Invalid world-pose parent chain");
          seen.add(at);
          at = graph.parents[at];
        }
      }
      const rows = new Uint8Array(n * 0x70),
        rowView = new DataView(rows.buffer),
        parents = new Uint8Array(n * 4),
        parentView = new DataView(parents.buffer);
      graph.jointIds.forEach((id, i) => rowView.setUint16(i * 0x70, id, true));
      graph.parents.forEach((id, i) => parentView.setInt32(i * 4, id, true));
      return {
        joints: [...graph.joints],
        parents: [...graph.parents],
        sample(localHex, rootHex, inheritScale = true) {
          ensure();
          if (
            !Array.isArray(localHex) ||
            localHex.length !== n ||
            typeof inheritScale !== "boolean"
          )
            throw Error("Invalid world-pose input");
          const local = localHex.map(transform),
            root = transform(rootHex);
          try {
            k.nextHeap = 0x10400000;
            k.allocations = new Map();
            e.mem_write(owned.rig, new Uint8Array(0x98));
            e.mem_write(owned.pose, new Uint8Array(0x120));
            e.mem_write(owned.rows, rows);
            e.mem_write(owned.parents, parents);
            e.mem_write(owned.root, root);
            k.u64(owned.rig + 0x28, owned.rows);
            u32(owned.rig + 0x30, n);
            k.u64(owned.pose + 8, owned.poses);
            u32(owned.pose + 0x10, n);
            k.u64(owned.pose + 0x70, owned.rig);
            k.u64(owned.pose + 0xc0, owned.parents);
            local.forEach((raw, i) => e.mem_write(owned.poses + i * 40, raw));
            const call = () =>
              k.callNative(meta.worldPassRva, {
                RDI: owned.pose,
                RSI: owned.root,
                RDX: inheritScale ? 1 : 0,
              });
            call();
            const result = {
              worldHex: Array.from({ length: n }, (_, i) =>
                hex(k.read(owned.poses + i * 40, 40)),
              ),
              changed: (e.reg_read_i64(uc.X86_REG_RAX) & 255n) !== 0n,
              revision: k.readU32(owned.pose),
              worldValid: k.read(owned.pose + 4, 1)[0] !== 0,
              rootHex: hex(k.read(owned.pose + 0xe0, 40)),
            };
            call();
            result.secondChanged =
              (e.reg_read_i64(uc.X86_REG_RAX) & 255n) !== 0n;
            if (
              result.secondChanged ||
              result.revision !== 1 ||
              !result.worldValid ||
              result.worldHex.some(
                (v, i) => v !== hex(k.read(owned.poses + i * 40, 40)),
              )
            )
              throw Error("Unexpected world-pose validity policy");
            return result;
          } catch (error) {
            poisoned = true;
            throw error;
          }
        },
      };
    },
    close() {
      if (!closed) {
        closed = true;
        k.close();
      }
    },
  };
}
