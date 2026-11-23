import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { verifyReplayParticipantBindings } from "../../replay-participant-bindings.mjs";
import { openReplay } from "../../transport.mjs";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";
import { decodeRecordedDragonKills } from "./recorded-dragon-kills.mjs";

const [decoderPath, ...replays] = process.argv.slice(2);
if (!decoderPath || !replays.length)
  throw Error(
    "Usage: bun verify-native-terrain-dragon-waypoints.mjs <prepared decoder> <replay> [replay ...]",
  );

const decoder = await readFile(decoderPath);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inflate = (bytes, output) =>
  zstdDecompressSync(bytes, { maxOutputLength: output.length });
const reviewedReplay =
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668";
// Archived macOS image (SHA-256 e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa), RVA 0x21485c0.
const creationTableSha256 =
  "328528d693ab5d96a815b6706694025a980e609019304aeb2e5e32797011c04b";
const rotate = (byte, shift) =>
  ((byte << shift) | (byte >>> (8 - shift))) & 0xff;

function readReviewedCreation(payload, table) {
  // The factory case for opcode 392 reaches reader 0x1024130. The five
  // reviewed bodies have a one-byte name length at offset 26. Header byte 6
  // selects the writer to object +0x38, subsequently passed to 0x17a890.
  const mode = (payload[6] >>> 1) & 3;
  if (mode !== 1 && mode !== 2)
    throw Error("Unreviewed creation name selector");
  const decode =
    mode === 1
      ? (byte) => rotate(rotate(table[(byte + 0x41) & 255], 4) ^ 0xee, 1)
      : (byte) => rotate(table[table[rotate(table[byte] ^ 0xa8, 7)]], 1);
  const length = decode(payload[26]);
  if (length < 19 || length > 23 || length > payload.length - 27)
    throw Error("Unreviewed creation name length");
  const nameBytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    let target = index;
    if (mode === 2) target = index % 2 ? length - 1 - (index >> 1) : index >> 1;
    nameBytes[target] = decode(payload[27 + index]);
  }
  const objectName = new TextDecoder("utf-8", { fatal: true }).decode(
    nameBytes,
  );
  const match = /^(sru_dragon_(?:earth|chemtech|fire))\.6\.1$/.exec(objectName);
  if (!match) throw Error("Unreviewed dragon creation name");
  return {
    opcode: 392,
    objectName,
    character: match[1],
    payloadSha256: digest(payload),
  };
}

for (const replayPath of replays) {
  const bytes = Uint8Array.from(await readFile(replayPath));
  const replaySha256 = digest(bytes);
  const replay = openReplay(bytes.buffer);
  const codecs = createExactTerrainByteCodecs(decoder, replay);
  const readWaypoints = createWaypointReaderFromCodecs(codecs);
  const table = Uint8Array.from(
    { length: 256 },
    (_, index) =>
      rotate((codecs.decodeSyncByte((index - 0x64) & 0xff) - 0xed) & 0xff, 2) ^
      0xff,
  );
  if (digest(table) !== creationTableSha256)
    throw Error("Unexpected archived dragon creation byte table");
  const { events } = decodeRecordedDragonKills(bytes.buffer, inflate);
  const subjects = new Map(
    events.map(({ subjectContext, timeSeconds }) => [
      subjectContext,
      { subjectContext, killTimeSeconds: timeSeconds, observations: [] },
    ]),
  );

  if (subjects.size) {
    verifyReplayParticipantBindings(replay, inflate, {
      observeGameplayPacket({ timeSeconds, payload }, opcode, context) {
        if (opcode === 392 && replaySha256 === reviewedReplay) {
          const subject = subjects.get(context);
          if (subject) {
            if (subject.creation)
              throw Error("Repeated reviewed dragon creation");
            subject.creation = {
              timeSeconds,
              ...readReviewedCreation(payload, table),
            };
          }
        }
        if (opcode !== 96 && opcode !== 1174) return;
        const { syncId, records } = readWaypoints(opcode, payload);
        for (const { entityId, encodedWaypoints, motion, speed } of records) {
          const subject = subjects.get(entityId);
          if (!subject) continue;
          subject.observations.push({
            timeSeconds,
            opcode,
            syncId,
            speed: motion?.speed ?? speed,
            encodedWaypoints,
          });
        }
      },
    });
  }
  if (replaySha256 === reviewedReplay) {
    for (const {
      creation,
      observations,
      killTimeSeconds,
    } of subjects.values()) {
      if (
        !creation ||
        !observations.length ||
        creation.timeSeconds > observations[0].timeSeconds ||
        observations[0].timeSeconds >= killTimeSeconds
      )
        throw Error(
          "Missing chronological dragon creation and movement evidence",
        );
    }
  }

  console.log(
    JSON.stringify({
      kind: "exact-terrain-dragon-waypoint-evidence",
      replaySha256,
      decoderSha256: digest(decoder),
      creationTableSha256,
      build: replay.build,
      protocol: replay.protocol,
      subjects: [...subjects.values()],
    }),
  );
}
