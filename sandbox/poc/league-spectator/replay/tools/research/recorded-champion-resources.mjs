import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeRegisteredState } from "../../latest-state-fields.mjs";
import { recordedChampionReplication } from "./recorded-champion-replication.mjs";

// Native registration at 0x13fb30 and getters linked by the Live Client API.
// The sibling native probe independently registers and reads both groups.
const schema = {
  groups: {
    1: { count: 28, floatMask: 0x0fffff07 },
    32: { count: 32, floatMask: 0x0f99fbff },
  },
  fields: {
    gold: { group: 1, index: 0, type: "float" },
    resource: { group: 32, index: 15, type: "float" },
    resourceMax: { group: 32, index: 16, type: "float" },
  },
};

function append(points, time, values) {
  const last = points.at(-1);
  if (last?.[0] === time) points[points.length - 1] = [time, ...values];
  else if (
    last === undefined ||
    values.some((value, i) => last[i + 1] !== value)
  ) {
    points.push([time, ...values]);
  }
}

export function extractRecordedChampionResources(
  binary,
  rawReplay,
  scene,
  onGroup,
) {
  const replication = recordedChampionReplication(binary, rawReplay, scene, {
    allowCurrentBuild: true,
    accepts: (group, mask) =>
      (group === 1 && (mask & 1) !== 0) ||
      (group === 32 && (mask & 0x18000) !== 0),
    includeSnapshots: onGroup !== undefined,
  });
  const participants = new Map(
    [...replication.participants].map((participantId) => [
      participantId,
      { gold: [], resource: [], values: {} },
    ]),
  );

  for (const {
    group,
    participantId,
    fieldMask,
    bytes,
    stream,
    timeSeconds,
  } of replication.read()) {
    const dataHex = bytes.toString("hex");
    const decoded = decodeRegisteredState(
      { groups: [{ group, mask: fieldMask, dataHex }] },
      schema,
    );
    const { values, consumerBits } = decoded;
    if (Object.values(values).some((v) => v < 0))
      throw Error("Negative recorded champion resource");
    onGroup?.({
      group,
      participantId,
      fieldMask,
      stream,
      dataHex,
      consumerBits,
    });
    if (stream !== 1) continue;
    const state = participants.get(participantId);
    if (values.gold !== undefined) {
      append(state.gold, timeSeconds, [values.gold]);
    }
    if (group === 32) {
      Object.assign(state.values, values);
      const { resource, resourceMax } = state.values;
      if (resource !== undefined && resourceMax !== undefined) {
        append(state.resource, timeSeconds, [resource, resourceMax]);
      }
    }
  }
  const tracks = [...participants].map(
    ([participantId, { gold, resource }]) => {
      if (gold.length === 0 || resource.length === 0)
        throw Error(
          `Missing recorded resource observations for champion ${participantId}`,
        );
      return { participantId, gold, resource };
    },
  );
  return {
    kind: "scout-recorded-champion-resources",
    ...replication.identity,
    tracks,
  };
}

if (import.meta.main) {
  const [archive, replay, scene, output, oracleInput] = process.argv.slice(2);
  if (!archive || !replay || !scene || !output) {
    throw Error(
      "Usage: bun recorded-champion-resources.mjs <archive> <replay> <bound-scene.json> <output.json> [oracle-groups.json]",
    );
  }
  const groups = [];
  const artifact = extractRecordedChampionResources(
    readFileSync(archive),
    readFileSync(replay),
    JSON.parse(readFileSync(scene, "utf8")),
    oracleInput === undefined ? undefined : (group) => groups.push(group),
  );
  const bytes = JSON.stringify(artifact) + "\n";
  writeFileSync(output, bytes, { flag: "wx" });
  if (oracleInput !== undefined) {
    writeFileSync(
      oracleInput,
      JSON.stringify({
        identity: artifact.replaySha256,
        build: artifact.build,
        groups,
      }),
      { flag: "wx" },
    );
  }
  console.log(
    JSON.stringify({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      tracks: artifact.tracks.map(({ participantId, gold, resource }) => [
        participantId,
        gold.length,
        resource.length,
      ]),
    }),
  );
}
