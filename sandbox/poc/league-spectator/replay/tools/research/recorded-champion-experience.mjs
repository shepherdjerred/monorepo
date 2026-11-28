import { readFileSync, writeFileSync } from "node:fs";
import { decodeRegisteredState } from "../../latest-state-fields.mjs";
import {
  readExactMap11Definition,
  readExactMayhemMapDefinition,
} from "../exact-map-bin.mjs";
import { extractRecordedChampionLevelCaps } from "./recorded-champion-level-cap.mjs";
import { recordedChampionReplication } from "./recorded-champion-replication.mjs";

export function readRecordedExperienceThresholds(bytes, build) {
  const { objects } = readExactMap11Definition(bytes, build);
  // Native GameMode::experienceCurve reads the object link registered at +0x110.
  const mode = objects.find(({ pathHash }) => pathHash === "0b03bf5a");
  const link = mode?.fields.fde22db7;
  if (
    mode?.classHash !== "89ce9636" ||
    mode.fields.bc476670?.value !== 0x48246d53 ||
    link?.type !== "ObjectLink" ||
    link.value !== 0xc6f6a84c
  )
    throw Error(
      "Map11 CLASSIC experience curve link differs from native registration",
    );
  return readExperienceCurve(objects, "c6f6a84c", "Map11 CLASSIC");
}

export function readRecordedMayhemExperienceThresholds(bytes) {
  const { objects } = readExactMayhemMapDefinition(bytes);
  const mode = objects.find(({ pathHash }) => pathHash === "8f4c3efd");
  const link = mode?.fields.fde22db7;
  if (
    mode?.classHash !== "89ce9636" ||
    mode.fields.bc476670?.value !== 0xbffdf499 ||
    link?.type !== "ObjectLink" ||
    link.value !== 0xd88e5d96
  )
    throw Error(
      "Map12 KIWI experience curve link differs from native registration",
    );
  return readExperienceCurve(objects, "d88e5d96", "Map12 KIWI");
}

function readExperienceCurve(objects, curvePath, mode) {
  const curve = objects.find(({ pathHash }) => pathHash === curvePath);
  const field = curve?.fields.bba38682;
  if (curve?.classHash !== "93f5c410" || field?.type !== "Container")
    throw Error(`${mode} experience curve definition differs`);
  // Both admitted modes keep the original constructor's cap of 18.
  if (curve.fields.f1f3d846 !== undefined)
    throw Error(`Unexpected ${mode} level cap override`);
  return field.elements.map(({ type, value }) => {
    if (type !== "F32") throw Error("Unexpected XP threshold type");
    return value;
  });
}

// Same-build native registration binds accumulated experience and level to
// one component. The original getter returns that component at hero + 0x3fe8.
const groupSchema = {
  groups: { 32: { count: 32, floatMask: 0x0f99fbff } },
  fields: {
    experience: { group: 32, index: 11, type: "float" },
    level: { group: 32, index: 28, type: "uint32" },
  },
};

export function extractRecordedChampionExperience(
  binary,
  rawReplay,
  scene,
  onGroup,
  options,
) {
  const replication = recordedChampionReplication(binary, rawReplay, scene, {
    accepts: (group, mask) => group === 32 && (mask & 0x10000800) !== 0,
    includeSnapshots: onGroup !== undefined,
    allowCurrentBuild: options?.allowCurrentBuild === true,
  });
  const participants = new Map(
    [...replication.participants].map((participantId) => [
      participantId,
      { points: [], values: {} },
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
    const { values, consumerBits } = decodeRegisteredState(
      { groups: [{ group, mask: fieldMask, dataHex }] },
      groupSchema,
    );
    if (
      values.experience < 0 ||
      (values.level !== undefined && (values.level < 1 || values.level > 255))
    ) {
      throw Error("Invalid recorded champion progression");
    }
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
    Object.assign(state.values, values);
    const { experience, level } = state.values;
    if (experience === undefined || level === undefined) continue;
    const previous = state.points.at(-1);
    if (previous?.[0] === timeSeconds)
      state.points[state.points.length - 1] = [timeSeconds, experience, level];
    else if (previous?.[1] !== experience || previous?.[2] !== level)
      state.points.push([timeSeconds, experience, level]);
  }
  const caps = extractRecordedChampionLevelCaps(
    rawReplay,
    participants.keys(),
    undefined,
    options,
  );
  const tracks = [...participants].map(([participantId, { points }]) => {
    if (points.length === 0)
      throw Error(`Missing recorded experience for champion ${participantId}`);
    return { participantId, levelCaps: caps.get(participantId) ?? [], points };
  });
  return {
    kind: "scout-recorded-champion-experience",
    ...replication.identity,
    tracks,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const current = args[0] === "--current";
  const [archive, replay, scene, output, oracleInput, ...extra] = current
    ? args.slice(1)
    : args;
  if (!archive || !replay || !scene || !output || extra.length !== 0) {
    throw Error(
      "Usage: bun recorded-champion-experience.mjs [--current] <archive> <replay> <bound-scene.json> <output.json> [oracle-groups.json]",
    );
  }
  const groups = [];
  const artifact = extractRecordedChampionExperience(
    readFileSync(archive),
    readFileSync(replay),
    JSON.parse(readFileSync(scene, "utf8")),
    oracleInput === undefined ? undefined : (group) => groups.push(group),
    { allowCurrentBuild: current },
  );
  const bytes = JSON.stringify(artifact) + "\n";
  writeFileSync(output, bytes, { flag: "wx" });
  if (oracleInput !== undefined) {
    writeFileSync(
      oracleInput,
      JSON.stringify({
        identity: artifact.replaySha256,
        ...(current ? { build: artifact.build } : {}),
        groups,
      }),
      { flag: "wx" },
    );
  }
  console.log(
    JSON.stringify({
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      points: artifact.tracks.reduce(
        (points, track) => points + track.points.length,
        0,
      ),
    }),
  );
}
