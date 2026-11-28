import { createCurrentMap11ControllerReader } from "./native-terrain-controller-reader.mjs";

const directClasses = new Set(["c406a533", "ec733fe2", "e07edfa4"]);
const compositeClass = "e21083b5";
const unresolvedIds = [0x6d9e7ec9, 0x76c50391];
const snapshotNames = new Set([
  0x7067adc8, 0xd1751a06, 0x6204d1e5, 0x625c62d8, 0x5086eb70, 0x17614a1d,
  0xdba9fcb3, 0x5cba1be9, 0x2978241b, 0xa28a5af4, 0x699b9ac4, 0x5571ac30,
  0x0b6005aa, 0x2936ed63, 0x0125cad8, 0xd4a12099,
]);
const deferredNames = [
  [0x309b774b, 0x81d63653, 0x3e5a58ce, 0x82bf1ade],
  [0x738c8da8, 0x215400aa],
];
const hashName = (name) => name.toString(16).padStart(8, "0");
const graphDigests = new Map([
  [
    "24716f3c47ed5eadaa80693f0113dffb21dd2b5ab419957c5ae91c3a0e77ad15",
    "1be42c5e4bbb0cc3af15295bc4f3d0a4149198b5c8538c6e21022b9ff9a92a28",
  ],
  [
    "4a8b2432fa3316647092fee062ff84c198f5e085ea11860aa4584082f46a889d",
    "32c2490cac9bc2acf7319c58c55ce41b6cf96e6f4f888d271d0b334d1e704a78",
  ],
  [
    "5b3ed6a403893e7c4f38aab225aeadb96c625283956ffd010d649de9b80a3ccc",
    "cc8d22ab357189efe67e15379d55353fa59902f28dd49b09cda99fe4c14600e2",
  ],
]);
const materialsDigest =
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a";

/** Authenticate the static graph in a worker message independently of replay timing. */
export async function verifyCurrentMap11ControllerGraph(input) {
  const {
    geometrySha256,
    materialsSha256,
    meshControllerIds,
    controllers,
    missingReplacementMeshControllerIds,
  } = input;
  const expected = graphDigests.get(geometrySha256);
  if (
    expected === undefined ||
    materialsSha256 !== materialsDigest ||
    !Array.isArray(meshControllerIds) ||
    (meshControllerIds.length !== 12 && meshControllerIds.length !== 13) ||
    controllers === null ||
    typeof controllers !== "object" ||
    Object.keys(controllers).length !== 35 ||
    !Array.isArray(missingReplacementMeshControllerIds) ||
    !(
      missingReplacementMeshControllerIds.length === 0 ||
      (missingReplacementMeshControllerIds.length === 2 &&
        missingReplacementMeshControllerIds[0] === 0x4aefd282 &&
        missingReplacementMeshControllerIds[1] === 0xa8951ff3)
    )
  )
    throw Error("Invalid authored Map11 worker controller graph");
  const encoded = JSON.stringify({ meshControllerIds, controllers });
  if (encoded.length > 8192)
    throw Error("Oversized authored Map11 worker controller graph");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encoded),
  );
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== expected)
    throw Error("Authored Map11 worker controller graph digest differs");
}

/** Collect only physical controller envelopes from the existing timed replay traversal. */
export function createMap11ControllerPacketCollector() {
  let opcode;
  let context = 0;
  const packets = [];
  const snapshotChunks = new Set();
  return {
    observe(packet) {
      if (packet.blockOffset === 0) {
        opcode = undefined;
        context = 0;
        if (packet.stream === 2) snapshotChunks.add(packet.chunkId);
      }
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      if (opcode !== 80) return;
      if (context !== 0 || (packet.stream !== 1 && packet.stream !== 2))
        throw Error("Unverified Map11 controller packet context or stream");
      if (packet.payload.byteLength > 10)
        throw Error("Map11 controller body exceeds the native portable layout");
      packets.push({
        stream: packet.stream,
        chunk: packet.chunkId,
        offset: packet.blockOffset,
        timeSeconds: packet.timeSeconds,
        payload: Uint8Array.from(packet.payload),
      });
    },
    finish() {
      return { packets, snapshotChunks: [...snapshotChunks] };
    },
  };
}

export function createCurrentMap11ControllerObserver(options) {
  const collector = createMap11ControllerPacketCollector();
  return {
    observe: collector.observe,
    finish() {
      return deriveCurrentMap11ControllerVisibility({
        ...options,
        ...collector.finish(),
      });
    },
  };
}

function openControllerGraph(controllers) {
  const graph = new Map(
    Object.entries(controllers).map(([key, node]) => [Number(key), node]),
  );
  const direct = new Map();
  for (const node of graph.values()) {
    if (directClasses.has(node.classHash)) {
      if (
        direct.has(node.nameHash) ||
        (node.defaultVisible !== null &&
          typeof node.defaultVisible !== "boolean")
      )
        throw Error("Invalid authored direct Map11 controller");
      direct.set(node.nameHash, node.defaultVisible ?? true);
    } else if (
      node.classHash !== compositeClass ||
      !Array.isArray(node.children) ||
      !node.children.every((child) => graph.has(child)) ||
      ![null, 0, 1, 2, 3].includes(node.operation)
    ) {
      throw Error("Invalid authored composite Map11 controller");
    }
  }
  function walk(key, leaf, composite, visiting) {
    if (visiting.has(key)) throw Error("Cyclic authored Map11 controller");
    const node = graph.get(key);
    if (node === undefined) throw Error("Unknown authored Map11 controller");
    if (directClasses.has(node.classHash)) return leaf(node.nameHash);
    visiting.add(key);
    const values = node.children.map((child) =>
      walk(child, leaf, composite, visiting),
    );
    visiting.delete(key);
    return composite(node.operation ?? 0, values);
  }
  const visible = (key) =>
    walk(
      key,
      (name) => direct.get(name),
      (op, values) => {
        switch (op) {
          case 0:
            return values.every(Boolean);
          case 1:
            return values.some(Boolean);
          case 2:
            return values.filter(Boolean).length === 1;
          case 3:
            return !values.some(Boolean);
          default:
            throw Error("Unknown authored Map11 controller operation");
        }
      },
      new Set(),
    );
  const dependsOn = (key, expected) =>
    walk(
      key,
      (name) => name === expected,
      (_op, values) => values.some(Boolean),
      new Set(),
    );
  return { graph, direct, visible, dependsOn };
}

function validateSnapshots(snapshots, recordedChunks, writes) {
  const chunks = new Set(recordedChunks);
  if (
    snapshots.values().next().value?.time !== 0 ||
    snapshots.size !== chunks.size ||
    [...snapshots.keys()].some((id) => !chunks.has(id))
  )
    throw Error("Incomplete recorded Map11 controller snapshots");
  const activations = [];
  for (const cohort of deferredNames) {
    const times = cohort.map(
      (name) => writes.find((row) => row.name === name)?.time,
    );
    if (times.every((time) => time === undefined)) continue;
    if (times[0] === undefined || !times.every((time) => time === times[0]))
      throw Error(
        "Unverified partial or staggered Map11 controller cohort activation",
      );
    activations.push({ time: times[0], cohort });
  }
  if (
    writes.some(
      ({ name }) =>
        !snapshotNames.has(name) &&
        !deferredNames.some((cohort) => cohort.includes(name)),
    )
  )
    throw Error("Unverified ordinary Map11 controller name");
  for (const [chunk, snapshot] of snapshots) {
    const expected = new Set(snapshotNames);
    for (const { time, cohort } of activations) {
      if (snapshot.time === time)
        throw Error(
          `Ambiguous Map11 controller activation in snapshot chunk ${chunk}`,
        );
      if (time < snapshot.time) cohort.forEach((name) => expected.add(name));
    }
    if (
      expected.size !== snapshot.names.size ||
      [...expected].some((name) => !snapshot.names.has(name))
    )
      throw Error(
        `Inconsistent recorded Map11 controller snapshot in chunk ${chunk}`,
      );
  }
}

function recoverWindows(tracks, snapshots, animated, duration) {
  const windows = [];
  for (const { name, time, affected } of animated) {
    const verified = [...snapshots.values()].find(
      (row) => row.time > time && row.names.has(name),
    );
    if (time <= 0 || verified === undefined || verified.time > duration)
      throw Error(
        `Animated Map11 controller ${hashName(name)} lacks a verified boundary snapshot`,
      );
    for (const controllerId of affected)
      windows.push({
        controllerId,
        startSeconds: time,
        endSeconds: verified.time,
      });
  }
  windows.sort(
    (a, b) =>
      a.controllerId - b.controllerId || a.startSeconds - b.startSeconds,
  );
  const priorEnds = new Map();
  for (const { controllerId, startSeconds, endSeconds } of windows) {
    if (startSeconds <= (priorEnds.get(controllerId) ?? 0))
      throw Error("Overlapping animated Map11 controller windows");
    priorEnds.set(controllerId, endSeconds);
    const points = tracks.get(controllerId);
    const prior = points.filter(([time]) => time < startSeconds);
    const admitted = points.findLast(([time]) => time <= endSeconds)[1];
    if (prior.at(-1)[1] !== admitted) prior.push([endSeconds, admitted]);
    tracks.set(controllerId, [
      ...prior,
      ...points.filter(([time]) => time > endSeconds),
    ]);
  }
  return windows;
}

/** Derive scoped mesh visibility from exact current opcode 80 and authored graph inputs. */
export function deriveCurrentMap11ControllerVisibility({
  identity,
  meshControllerIds,
  controllers,
  packets,
  snapshotChunks,
  codecs,
  durationSeconds,
}) {
  const read = createCurrentMap11ControllerReader(identity, codecs);
  const { graph, direct, visible, dependsOn } =
    openControllerGraph(controllers);
  const tracks = new Map();
  const unresolved = meshControllerIds.filter((key) => !graph.has(key));
  if (
    unresolved.length !== unresolvedIds.length ||
    unresolvedIds.some((key) => !unresolved.includes(key))
  )
    throw Error("Unresolved exported Map11 controller cohort changed");
  if (new Set(meshControllerIds).size !== meshControllerIds.length)
    throw Error("Duplicated authored Map11 mesh controller");
  for (const key of meshControllerIds)
    if (graph.has(key)) tracks.set(key, [[0, visible(key)]]);
  const snapshots = new Map();
  const writes = [];
  const animated = [];
  const ordered = [...packets].sort(
    (a, b) =>
      a.timeSeconds - b.timeSeconds ||
      a.stream - b.stream ||
      a.offset - b.offset,
  );
  for (const { stream, chunk, timeSeconds, payload } of ordered) {
    if (
      (stream !== 1 && stream !== 2) ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds > durationSeconds
    )
      throw Error("Invalid recorded Map11 controller envelope");
    const { name, visible: target, transition } = read(payload);
    if (!direct.has(name))
      throw Error(`Unbound recorded Map11 controller ${hashName(name)}`);
    if (
      transition !== 0 &&
      (stream !== 1 || !Number.isFinite(transition) || transition < 0)
    )
      throw Error("Unverified recorded Map11 controller transition");
    if (stream === 2) {
      let snapshot = snapshots.get(chunk);
      if (snapshot === undefined) {
        snapshot = { time: timeSeconds, names: new Set() };
        snapshots.set(chunk, snapshot);
      }
      if (
        snapshot.time !== timeSeconds ||
        snapshot.names.has(name) ||
        direct.get(name) !== target
      )
        throw Error(
          `Snapshot disagrees with authored and ordinary state for ${hashName(name)}`,
        );
      snapshot.names.add(name);
      continue;
    }
    const write = {
      name,
      time: timeSeconds,
      visible: target,
      animated: transition !== 0,
    };
    writes.push(write);
    if (transition !== 0)
      animated.push({
        ...write,
        affected: [...tracks.keys()].filter((key) => dependsOn(key, name)),
      });
    direct.set(name, target);
    for (const [key, points] of tracks) {
      const next = visible(key);
      const previous = points.at(-1);
      if (previous[1] !== next) {
        if (previous[0] === timeSeconds) previous[1] = next;
        else points.push([timeSeconds, next]);
      }
    }
  }
  validateSnapshots(snapshots, snapshotChunks, writes);
  const unresolvedWindows = recoverWindows(
    tracks,
    snapshots,
    animated,
    durationSeconds,
  );
  return {
    ...identity,
    tracks: [...tracks].map(([controllerId, points]) => ({
      controllerId,
      points,
    })),
    unresolvedMeshControllerIds: unresolved,
    ...(unresolvedWindows.length ? { unresolvedWindows } : {}),
    unboundRecordedNameHashes: [],
    ordinaryWrites: writes
      .filter(({ animated }) => !animated)
      .map(({ name, time, visible }) => ({
        nameHash: hashName(name),
        timeSeconds: time,
        visible,
      })),
  };
}
