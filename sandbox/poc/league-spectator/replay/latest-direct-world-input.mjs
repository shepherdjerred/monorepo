import { readPresentationBaseFlags } from "./latest-presentation-targets.mjs";
import {
  isReplayRows,
  packReplayRows,
  replayRowCount,
  replayRowProjection,
  replayColumnTransfers,
} from "./latest-replay-columns.mjs";

export const DIRECT_WORLD_INPUT_KIND = "consumed-native-world-input-v1";
const owners = new WeakMap();
const scalars = Object.freeze([
  "build",
  "protocol",
  "replaySha256",
  "duration",
  "endTime",
  "decoderImageSha256",
  "constructorImageSha256",
  "fieldCodecsSha256",
  "championStatePackageSha256",
]);
const arrays = Object.freeze([
  "heroes",
  "movement",
  "lifecycle",
  "casts",
  "attacks",
  "animations",
  "missiles",
  "missileEvents",
  "worldEvents",
  "resourceRequests",
]);
const descriptorFields = Object.freeze([
  "attachmentEntityId",
  "lookup14EntityId",
  "attachmentKey4c",
  "attachmentKey50",
]);
const neutralFields = Object.freeze([
  "neutralCreations",
  "neutralSnapshots",
  "neutralCreationPackageSha256",
]);
const fields = Object.freeze([
  ...scalars,
  ...arrays,
  "replicationRecords",
  "visibilityRequests",
  "effectDescriptors",
  ...neutralFields,
]);
const requiredFields = fields.filter((key) => !neutralFields.includes(key));
function assertFields(report) {
  if (
    !report ||
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    requiredFields.some((key) => !Object.hasOwn(report, key)) ||
    arrays.some((key) => !Array.isArray(report[key])) ||
    !Array.isArray(report.replicationRecords) ||
    !isReplayRows(report.visibilityRequests) ||
    !isReplayRows(report.effectDescriptors)
  )
    throw Error("Complete consumed native world report fields required");
  if (
    neutralFields.some((key) => Object.hasOwn(report, key)) &&
    (neutralFields.some((key) => !Object.hasOwn(report, key)) ||
      !Array.isArray(report.neutralCreations) ||
      !Array.isArray(report.neutralSnapshots) ||
      (report.neutralCreationPackageSha256 === null
        ? report.neutralCreations.length > 0 ||
          report.neutralSnapshots.length > 0
        : !/^[a-f0-9]{64}$/.test(report.neutralCreationPackageSha256)))
  )
    throw Error(
      "Complete separate neutral gameplay/snapshot world inputs required",
    );
}

// A derived worker contract, not a replacement for the complete replay report.
// Every retained track remains lossless. Replication selection exactly matches
// the original target-policy consumer; descriptor data here is explicitly only
// the four attachment identity/key inputs consumed by the pose service.
export function projectLatestDirectWorldInput(report) {
  assertFields(report);
  const selected = Object.fromEntries(
    [...scalars, ...arrays].map((key) => [key, report[key]]),
  );
  if (Object.hasOwn(report, "neutralCreations"))
    for (const key of neutralFields) selected[key] = report[key];
  const heroes = new Set(report.heroes.map((hero) => hero.entityId));
  selected.replicationRecords = report.replicationRecords.filter(
    (record) =>
      heroes.has(record.entityId) && readPresentationBaseFlags(record) !== null,
  );
  selected.visibilityRequests = report.visibilityRequests;
  const rows = Array.from(
    { length: replayRowCount(report.effectDescriptors) },
    (_, index) =>
      replayRowProjection(report.effectDescriptors, index, descriptorFields),
  );
  selected.effectDescriptors = packReplayRows(rows);
  const omittedFields = Object.keys(report).filter(
    (key) => !fields.includes(key),
  );
  const input = {
    kind: DIRECT_WORLD_INPUT_KIND,
    report: selected,
    omittedFields,
    descriptorProjection: [...descriptorFields],
  };
  const buffers = replayColumnTransfers(selected.effectDescriptors);
  const ownership = Object.freeze({});
  owners.set(ownership, {
    input,
    buffers,
    bytes: buffers.map((buffer) => buffer.byteLength),
  });
  return {
    input,
    ownership,
    counts: {
      originalReplicationRecords: report.replicationRecords.length,
      targetReplicationRecords: selected.replicationRecords.length,
      descriptorRows: rows.length,
      descriptorBufferBytes: buffers.reduce((n, b) => n + b.byteLength, 0),
      retainedFields: Object.keys(selected).length,
      omittedFields: omittedFields.length,
    },
  };
}

export function consumeLatestDirectWorldInput(ownership, input) {
  const owner = owners.get(ownership);
  if (!owner || owner.input !== input)
    throw Error("Unused owned direct world input required");
  owners.delete(ownership);
  const buffers = replayColumnTransfers(input.report.effectDescriptors);
  if (
    buffers.length !== owner.buffers.length ||
    buffers.some(
      (buffer, index) =>
        buffer !== owner.buffers[index] ||
        buffer.byteLength !== owner.bytes[index],
    )
  )
    throw Error("Owned direct world descriptor buffers changed or detached");
  return buffers;
}

export function restoreLatestDirectWorldInput(input) {
  if (
    input?.kind !== DIRECT_WORLD_INPUT_KIND ||
    !Array.isArray(input.omittedFields) ||
    !Array.isArray(input.descriptorProjection) ||
    JSON.stringify(input.descriptorProjection) !==
      JSON.stringify(descriptorFields) ||
    new Set(input.omittedFields).size !== input.omittedFields.length ||
    input.omittedFields.some(
      (key) => typeof key !== "string" || fields.includes(key),
    ) ||
    Object.keys(input.report ?? {}).some((key) => !fields.includes(key))
  )
    throw Error("Versioned consumed native world input required");
  assertFields(input.report);
  const report = { ...input.report };
  // Optional chaining/default values must not hide a newly consumed source
  // field. These getters exist only after worker receipt, never on the wire.
  for (const key of input.omittedFields)
    Object.defineProperty(report, key, {
      enumerable: false,
      get() {
        throw Error(
          `Direct world consumer requires omitted original field: ${key}`,
        );
      },
    });
  return report;
}
