import { sha256 } from "./structural-comparison.mjs";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";
import { animationHash } from "./latest-animation.mjs";
import { SUBMESH_VISIBILITY_SHA } from "./latest-submesh-visibility-contract.mjs";
import { assertLatestSelectedSubmesh } from "./latest-selected-submesh.mjs";
export { SUBMESH_VISIBILITY_SHA } from "./latest-submesh-visibility-contract.mjs";
const f = Math.fround,
  finite = (v) => typeof v === "number" && Number.isFinite(f(v)),
  uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff,
  ascii = (v) => typeof v === "string" && /^[\x20-\x7e]+$/.test(v),
  hash = (name) => parseInt(animationHash(name).slice(1, -1), 16);

// Translation of the original scheduler for its concrete submesh-event class.
// Its end callback has no inverse mask write. Resync resets scheduler state,
// while retaining context masks; restoring visibility requires a checkpoint.
export function createSubmeshVisibilityScheduler(
  names,
  events,
  initial = 0xffffffff,
  avatar = 0xffffffff,
) {
  if (
    !Array.isArray(names) ||
    !names.length ||
    names.length > 32 ||
    names.some((n) => !ascii(n)) ||
    !Array.isArray(events) ||
    events.length > 1024 ||
    !uint(initial) ||
    !uint(avatar)
  )
    throw Error("Invalid submesh scheduler inputs");
  const ids = new Set(),
    mapping = new Map();
  names.forEach((name, i) =>
    mapping.set(hash(name), ((mapping.get(hash(name)) ?? 0) | (1 << i)) >>> 0),
  );
  const mask = (names) =>
      names.reduce((v, name) => (v | (mapping.get(hash(name)) ?? 0)) >>> 0, 0),
    specs = events.map((e) => {
      if (
        !e ||
        typeof e.id !== "string" ||
        !e.id ||
        ids.has(e.id) ||
        Object.keys(e).some(
          (k) =>
            ![
              "id",
              "startFrame",
              "endFrame",
              "fireIfEarly",
              "avatarOnly",
              "show",
              "hide",
              "showMask",
              "hideMask",
            ].includes(k),
        )
      )
        throw Error("Invalid submesh event identity");
      ids.add(e.id);
      const s = {
        startFrame: 0,
        endFrame: -1,
        fireIfEarly: false,
        avatarOnly: false,
        show: [],
        hide: [],
        ...e,
      };
      if (
        !finite(s.startFrame) ||
        !finite(s.endFrame) ||
        typeof s.fireIfEarly !== "boolean" ||
        typeof s.avatarOnly !== "boolean" ||
        ![s.show, s.hide].every((a) => Array.isArray(a) && a.every(ascii))
      )
        throw Error("Invalid submesh event");
      if (
        (Object.hasOwn(s, "showMask") && s.showMask !== mask(s.show)) ||
        (Object.hasOwn(s, "hideMask") && s.hideMask !== mask(s.hide))
      )
        throw Error("Prepared submesh mask differs from its named ranges");
      return {
        ...s,
        startFrame: f(s.startFrame),
        endFrame: f(s.endFrame),
        showMask: mask(s.show),
        hideMask: mask(s.hide),
      };
    }),
    checkpoints = new WeakMap();
  let states, masks, last;
  const reset = () => {
    states = specs.map((s, index) => ({
      event: s.id,
      oneShot: s.endFrame < 0 || s.endFrame < s.startFrame,
      pending: false,
      active: false,
      phase: 0,
      index,
    }));
    masks = [initial, avatar];
    last = null;
  };
  const apply = (s) => {
    const index = s.avatarOnly ? 1 : 0;
    masks[index] = ((masks[index] & ~s.hideMask) | s.showMask) >>> 0;
  };
  reset();
  return {
    reset,
    step(frame, resync = false) {
      if (!finite(frame) || typeof resync !== "boolean")
        throw Error("Invalid submesh clock");
      frame = f(frame);
      if (!resync && last !== null && frame < last)
        throw Error("Backward submesh clock requires resync");
      for (const [i, s] of specs.entries()) {
        const state = states[i];
        if (resync) {
          state.active = false;
          if (s.endFrame >= 0 && frame >= s.endFrame) state.phase = 2;
          else if (frame < s.startFrame) state.phase = 0;
          else {
            state.pending = state.oneShot;
            state.phase = 1;
            apply(s);
            state.active = true;
          }
        }
        if (state.phase === 2) {
          state.active = false;
          continue;
        }
        if (state.phase === 0) {
          if (state.pending) {
            state.pending = false;
            state.active = false;
          }
          if (frame < s.startFrame) continue;
          if (state.oneShot) state.pending = true;
          state.phase = 1;
          apply(s);
          state.active = true;
        }
        if (
          s.endFrame >= 0 &&
          frame >= s.endFrame &&
          (!state.oneShot || !state.pending)
        ) {
          state.active = false;
          state.phase = 2;
        } else apply(s);
      }
      last = frame;
      return {
        masks: [...masks],
        states: states.map((s) => {
          const bytes = new Uint8Array(12),
            view = new DataView(bytes.buffer);
          bytes[0] = +s.oneShot;
          bytes[1] = +s.pending;
          bytes[2] = +s.active;
          view.setUint32(4, s.phase, true);
          view.setUint32(8, s.index, true);
          return {
            event: s.event,
            bytes: [...bytes]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
          };
        }),
      };
    },
    checkpoint() {
      const handle = Object.freeze({});
      checkpoints.set(handle, {
        states: structuredClone(states),
        masks: [...masks],
        last,
      });
      return handle;
    },
    restore(handle) {
      const p = checkpoints.get(handle);
      if (!p) throw Error("Unowned submesh checkpoint");
      states = structuredClone(p.states);
      masks = [...p.masks];
      last = p.last;
    },
    releaseCheckpoint(handle) {
      if (!checkpoints.delete(handle))
        throw Error("Unowned submesh checkpoint");
    },
  };
}

export async function createLatestSubmeshVisibility(
  profile,
  sceneBytes,
  bytes,
  staticCatalog = null,
) {
  sceneBytes = ownLatestStaticBytes(sceneBytes);
  bytes = ownLatestStaticBytes(bytes);
  if (staticCatalog !== null)
    await assertLatestSelectedSubmesh({
      selection: staticCatalog,
      profile,
      packageBytes: bytes,
      sceneBytes,
    });
  else if ((await sha256(bytes)) !== SUBMESH_VISIBILITY_SHA)
    throw Error("Pinned submesh visibility package required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-submesh-visibility" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    (await sha256(sceneBytes)) !== meta.sceneManifestSha256
  )
    throw Error("Unsupported submesh visibility build/scene");
  return {
    metadata: structuredClone(meta),
    async bind(asset, modelBytes, graphBytes) {
      const entry = meta.assets[asset.animationGraph];
      if (
        !entry ||
        asset.model !== entry.model ||
        (await sha256(modelBytes)) !== entry.modelSha256 ||
        (await sha256(graphBytes)) !== entry.graphSha256 ||
        JSON.stringify(asset.hidden) !== JSON.stringify(entry.hidden)
      )
        throw Error("Unbound submesh asset");
      const names = entry.ranges.map((r) => r.name),
        hidden = new Set(asset.hidden.map((n) => hash(n))),
        initial = entry.ranges.reduce(
          (m, r) => (hidden.has(r.hash) ? (m & ~r.mask) >>> 0 : m),
          0xffffffff,
        ),
        clips = new Map(
          Object.entries(entry.clips).map(([name, c]) => [
            animationHash(name),
            c,
          ]),
        ),
        allClips = new Set(entry.allClips.map((name) => animationHash(name)));
      return {
        ranges: structuredClone(entry.ranges),
        initialMask: initial,
        sample(name, frame) {
          if (!finite(frame) || frame < 0 || !allClips.has(animationHash(name)))
            throw Error("Unadmitted visibility clip/frame");
          const clip = clips.get(animationHash(name));
          if (!clip)
            return { mask: initial, status: "no-submesh-events", events: 0 };
          if (clip.events.some((e) => e.avatarOnly))
            throw Error("Avatar-only graphics composition remains unadmitted");
          const scheduler = createSubmeshVisibilityScheduler(
              names,
              clip.events,
              initial,
            ),
            boundaries = [
              ...new Set([
                0,
                ...clip.events
                  .flatMap((e) => [f(e.startFrame), f(e.endFrame)])
                  .filter((v) => v >= 0 && v <= f(frame)),
                f(frame),
              ]),
            ].sort((a, b) => a - b);
          let result;
          for (const at of boundaries) result = scheduler.step(at);
          return {
            mask: result.masks[0],
            status: "native-masks-with-supplied-boundary-clock",
            events: clip.events.length,
          };
        },
      };
    },
  };
}

// Current avatar GLBs preserve the SKN material names. Unsupported materials stay
// omitted; this updates mesh visibility without replacing material definitions.
export function bindSubmeshVisibilityNodes(
  root,
  binding,
  unsupportedMaterials,
) {
  const unsupported = new Set(
      Object.keys(unsupportedMaterials).map((n) => hash(n)),
    ),
    masks = new Map(binding.ranges.map((r) => [r.hash, r.mask])),
    nodes = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    if (materials.length !== 1 || !masks.has(hash(materials[0].name)))
      throw Error("Unbound avatar submesh primitive");
    const key = hash(materials[0].name);
    nodes.push({ node, mask: masks.get(key), omitted: unsupported.has(key) });
  });
  if (!nodes.length) throw Error("No avatar submeshes");
  return {
    apply(mask) {
      if (!uint(mask)) throw Error("Invalid submesh mask");
      for (const row of nodes)
        row.node.visible = !row.omitted && !!(mask & row.mask);
    },
  };
}
