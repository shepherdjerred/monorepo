// Compare observed opening structure cohorts. Fingerprints carry no geometry
// or structure labels. A repeated fingerprint does not identify an individual.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { readReplayTurretLossCounts } from "../replay-turret-events.mjs";
import { readReplayTurretSides } from "../replay-turret-sides.mjs";
import { openReplay, replayPacketEnvelopes } from "../transport.mjs";

export function verifyStructureFingerprints(envelopes, turretLosses = []) {
  let frame;
  let opening;
  let keyframes = 0;
  let stableRecords = 0;
  let missingLaterMarkers = 0;
  let additionalLaterMarkers = 0;
  let opcode;
  let context;
  const groups = new Map();
  // Only the opening remains comparable by this pair. The 1012 payload can
  // change in subsequent keyframes even when the 111 fingerprint is unchanged.
  const openingMarkers = new Map();
  const openingIdentityGroups = new Map();
  const lossTimes = new Map(
    turretLosses.map(({ context, timeSeconds }) => [context, timeSeconds]),
  );
  if (lossTimes.size !== turretLosses.length)
    throw Error("Expected distinct verified turret loss contexts");
  for (const timeSeconds of lossTimes.values())
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
      throw Error("Expected valid primary clocks for verified turret losses");
  const clock = new DataView(new ArrayBuffer(4));
  const turretSnapshots = {
    cohort: "verified-destroyed-turrets",
    contexts: lossTimes.size,
    alive: 0,
    dead: 0,
    unknownMissing: 0,
    unknownSameTime: 0,
  };
  const finishFrame = () => {
    if (!frame) return;
    for (const [id, lostAt] of lossTimes) {
      const observedDead = frame.turretStates.get(id);
      if (frame.timeSeconds === lostAt) {
        turretSnapshots.unknownSameTime++;
      } else if (observedDead === undefined) {
        turretSnapshots.unknownMissing++;
      } else {
        const expectedDead = frame.timeSeconds > lostAt;
        if (observedDead !== expectedDead)
          throw Error(
            "Turret snapshot bit disagrees with verified loss history",
          );
        turretSnapshots[observedDead ? "dead" : "alive"]++;
      }
    }
    const isOpening = opening === undefined;
    if (isOpening) {
      if (frame.marked.size === 0)
        throw Error("No opening structure contexts were marked");
      opening = new Map(Array.from(frame.marked, (id) => [id, undefined]));
    } else {
      for (const id of frame.marked)
        if (!opening.has(id)) additionalLaterMarkers++;
    }
    for (const [id, expected] of opening) {
      const encodings = frame.fingerprints.get(id);
      if (encodings?.length !== 1)
        throw Error(
          "Expected one structure fingerprint per opening context in every keyframe",
        );
      const [encoding] = encodings;
      if (isOpening) {
        opening.set(id, encoding);
        const contexts = groups.get(encoding) ?? [];
        contexts.push(id);
        groups.set(encoding, contexts);
        const marker = openingMarkers.get(id);
        if (marker === null)
          throw Error("Expected one structure marker per opening context");
        const composite = marker + encoding;
        const peers = openingIdentityGroups.get(composite) ?? [];
        peers.push(id);
        openingIdentityGroups.set(composite, peers);
      } else {
        if (encoding !== expected)
          throw Error(
            "A structure fingerprint changed after the opening keyframe",
          );
        if (!frame.marked.has(id)) missingLaterMarkers++;
      }
      stableRecords++;
    }
    keyframes++;
  };

  for (const packet of envelopes) {
    if (packet.stream !== 2) continue;
    if (packet.blockOffset === 0) {
      finishFrame();
      clock.setUint32(0, packet.firstTimeBits, true);
      const timeSeconds = clock.getFloat32(0, true);
      if (
        lossTimes.size &&
        (packet.marker & 128 ||
          !Number.isFinite(timeSeconds) ||
          timeSeconds < 0)
      )
        throw Error("Expected an absolute primary clock for turret snapshots");
      frame = {
        timeSeconds,
        marked: new Set(),
        fingerprints: new Map(),
        turretStates: new Map(),
      };
      opcode = null;
      context = 0;
    }
    if (!frame) throw Error("Expected a complete opening keyframe");
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode === 1012 && packet.payload.length === 41) {
      frame.marked.add(context);
      if (lossTimes.has(context)) {
        const dead = (packet.payload[13] & 8) === 0;
        const previous = frame.turretStates.get(context);
        if (previous !== undefined && previous !== dead)
          throw Error("Conflicting turret snapshot bits for the same context");
        frame.turretStates.set(context, dead);
      }
      if (!opening)
        openingMarkers.set(
          context,
          openingMarkers.has(context)
            ? null
            : Buffer.from(packet.payload).toString("hex"),
        );
    }
    if (
      opcode === 111 &&
      packet.payload.length === 13 &&
      (!opening || opening.has(context))
    ) {
      const encodings = frame.fingerprints.get(context) ?? [];
      encodings.push(Buffer.from(packet.payload).toString("hex"));
      frame.fingerprints.set(context, encodings);
    }
  }
  finishFrame();
  if (!opening) throw Error("No structure keyframes were available");
  return {
    groups,
    openingIdentityGroups,
    turretSnapshots,
    keyframes,
    contexts: opening.size,
    stableRecords,
    missingLaterMarkers,
    additionalLaterMarkers,
  };
}

function compareGroups(left, right) {
  const uniqueAssignments = [];
  const unresolvedGroups = [];
  for (const [encoding, leftContexts] of left) {
    const rightContexts = right.get(encoding);
    if (!rightContexts) continue;
    const fingerprint = createHash("sha256")
      .update(Buffer.from(encoding, "hex"))
      .digest("hex");
    if (leftContexts.length === 1 && rightContexts.length === 1)
      uniqueAssignments.push({
        fingerprint,
        leftContext: leftContexts[0],
        rightContext: rightContexts[0],
      });
    else unresolvedGroups.push({ fingerprint, leftContexts, rightContexts });
  }
  return { uniqueAssignments, unresolvedGroups };
}

export function compareStructureFingerprints(left, right) {
  return {
    ...compareGroups(left.groups, right.groups),
    openingIdentity: compareGroups(
      left.openingIdentityGroups,
      right.openingIdentityGroups,
    ),
  };
}

/** Corroborate the observed partition bit against the separate loss records. */
export function verifyStructurePartitions(
  fingerprints,
  losses,
  expectedLosses,
) {
  const assignments = new Map();
  const candidateCounts = [0, 0];
  for (const [encoding, contexts] of fingerprints.groups) {
    const sideByte = Buffer.from(encoding, "hex")[8];
    const partition = 1 - ((sideByte >> 5) & 1);
    for (const context of contexts) {
      assignments.set(context, partition);
      candidateCounts[partition]++;
    }
  }
  const verifiedLosses = [0, 0];
  const matched = new Set();
  for (const { context, defendingPartition: partition } of losses) {
    if (
      matched.has(context) ||
      (partition !== 0 && partition !== 1) ||
      assignments.get(context) !== partition
    )
      throw Error(
        "Structure partition does not match a distinct reported turret loss",
      );
    matched.add(context);
    verifiedLosses[partition]++;
  }
  if (
    verifiedLosses.some(
      (count, partition) => count !== expectedLosses[partition],
    )
  )
    throw Error(
      "Verified structure partitions differ from the footer turret losses",
    );
  return {
    classifier: { byteOffset: 8, bit: 5, inverted: true },
    evidence: matched.size === 0 ? "zero-loss-control" : "loss-corroborated",
    candidateCounts,
    verifiedLosses,
    candidateAssignments: [...assignments].map(([context, partition]) => ({
      context,
      partition,
    })),
  };
}

function inspect(path) {
  const bytes = readFileSync(path);
  const replay = openReplay(Uint8Array.from(bytes).buffer);
  const decompress = (stored, target) =>
    zstdDecompressSync(stored, { maxOutputLength: target.byteLength });
  const turretLosses = readReplayTurretSides(replay, decompress);
  const fingerprints = verifyStructureFingerprints(
    replayPacketEnvelopes(replay, decompress),
    turretLosses,
  );
  const { groups, openingIdentityGroups, ...counts } = fingerprints;
  const partitionEvidence = verifyStructurePartitions(
    fingerprints,
    turretLosses,
    readReplayTurretLossCounts(replay),
  );
  return {
    groups,
    openingIdentityGroups,
    description: {
      replaySha256: createHash("sha256").update(bytes).digest("hex"),
      build: replay.build,
      protocol: replay.protocol,
      ...counts,
      partitionEvidence,
      singletonFingerprints: [...groups.values()].filter(
        (ids) => ids.length === 1,
      ).length,
      repeatedFingerprints: [...groups.values()].filter((ids) => ids.length > 1)
        .length,
    },
  };
}

if (import.meta.main) {
  const [first, second, ...extra] = process.argv.slice(2);
  if (!first || !second || extra.length)
    throw Error(
      "Usage: node verify-structure-fingerprints.mjs <first.rofl> <second.rofl>",
    );
  const left = inspect(first);
  const right = inspect(second);
  console.log(
    JSON.stringify(
      {
        left: left.description,
        right: right.description,
        ...compareStructureFingerprints(left, right),
      },
      null,
      2,
    ),
  );
}
