import { createHash } from "node:crypto";
import { verifyReplayParticipantBindings } from "../../replay-participant-bindings.mjs";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";

const replaySha256 =
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668";
// Archived macOS reader 0x1024130, byte table at 0x21485c0.
const creationTableSha256 =
  "328528d693ab5d96a815b6706694025a980e609019304aeb2e5e32797011c04b";
const actorContext = 1073742162;

const reviewed = [
  {
    context: 1073778817,
    name: "SRU_RiftHerald.4.1",
    modelId: "sru_riftherald",
    killTimeSeconds: 922.249119140625,
    killClock: 1148015197,
    announcement: "4f726a215a2d3fc12c6d592ad889b08f4c28",
    terminal:
      "60d852f10dd60f100fc824b8fd5207d702524a643f525dd9e4de31cfc21ce5d1eb",
    subjectWitness: "e411",
    actor: "0ff54216",
    actorWitness: "01f54216",
  },
  {
    context: 1073795611,
    name: "SRU_Baron",
    modelId: "sru_baron",
    killTimeSeconds: 1280.5053291015624,
    killClock: 1151562085,
    announcement: "7c746a215a2d3fc1c540cf01edf6294b76e6",
    terminal:
      "6ed8e6410981875f14c516244e94528afd52524a424e52997ccef4f488202071d1eb",
    subjectWitness: "e411",
    actor: "0aee7936",
    actorWitness: "01ee7936",
  },
  {
    context: 1073823282,
    name: "SRU_Baron",
    modelId: "sru_baron",
    killTimeSeconds: 1656.170228515625,
    killClock: 1154639528,
    announcement: "c4736a215a2d3fc1c540cf01edf6294b76e6",
    terminal:
      "68d80a500181875f14c516244e94528afd52524a424e52997ccef4f488202071d1eb",
    subjectWitness: "a311",
    actor: "0f75d4b7",
    actorWitness: "0475d4b7",
  },
];

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rotate = (byte, shift) =>
  ((byte << shift) | (byte >>> (8 - shift))) & 0xff;
const swapBits = (byte) => ((byte >>> 1) & 0x55) | ((byte << 1) & 0xaa);
const utf8 = new TextDecoder("utf-8", { fatal: true });

function readCreationName(payload, table) {
  const mode = (payload[6] >>> 1) & 3;
  const decoders = [
    (byte) => rotate(swapBits(table[byte]), 1) ^ 0xa6,
    (byte) => rotate(rotate(table[(byte + 0x41) & 255], 4) ^ 0xee, 1),
    (byte) => rotate(table[table[rotate(table[byte] ^ 0xa8, 7)]], 1),
  ];
  const decode = decoders[mode];
  if (!decode || payload.length <= 27)
    throw Error("Unsupported neutral objective creation name selector");
  const length = decode(payload[26]);
  if (!length || length > payload.length - 27)
    throw Error("Invalid neutral objective creation name length");
  const name = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    let target = index;
    if (mode === 0) target = length - 1 - index;
    if (mode === 2) target = index % 2 ? length - 1 - (index >> 1) : index >> 1;
    name[target] = decode(payload[index + 27]);
  }
  return utf8.decode(name);
}

/** Replay-specific spectator evidence for the two Barons and one pit Herald. */
export function decodeRecordedNeutralObjectives(replay, decoderBytes, inflate) {
  if (sha(replay.bytes) !== replaySha256) return null;
  const codecs = createExactTerrainByteCodecs(decoderBytes, replay);
  const readWaypoints = createWaypointReaderFromCodecs(codecs);
  const table = Uint8Array.from(
    { length: 256 },
    (_, index) =>
      rotate((codecs.decodeSyncByte((index - 0x64) & 0xff) - 0xed) & 0xff, 2) ^
      0xff,
  );
  if (sha(table) !== creationTableSha256)
    throw Error("Unexpected archived objective creation byte table");

  const subjects = new Map(
    reviewed.map((review) => [
      review.context,
      {
        review,
        creation: null,
        observations: [],
        killRecords: [],
        killWaypoints: [],
      },
    ]),
  );
  const byClock = new Map(
    reviewed.map(({ killClock, context }) => [
      killClock,
      subjects.get(context),
    ]),
  );
  const binding = verifyReplayParticipantBindings(replay, inflate, {
    observeGameplayPacket(
      { timeSeconds, secondTimeBits, payload },
      opcode,
      context,
    ) {
      const subject = subjects.get(context);
      if (subject && opcode === 392) {
        const objectName = readCreationName(payload, table);
        if (subject.creation || objectName !== subject.review.name)
          throw Error("Unexpected neutral objective creation");
        subject.creation = {
          objectName,
          creationTimeSeconds: timeSeconds,
          creationPayloadSha256: sha(payload),
        };
      }

      const kill = byClock.get(secondTimeBits);
      if (kill && timeSeconds === kill.review.killTimeSeconds) {
        kill.killRecords.push([
          opcode,
          context,
          Buffer.from(payload).toString("hex"),
        ]);
      }

      if (opcode !== 96 && opcode !== 1174) return;
      const { syncId, records } = readWaypoints(opcode, payload);
      for (const { entityId, encodedWaypoints, motion, speed } of records) {
        const track = subjects.get(entityId);
        if (!track || timeSeconds > track.review.killTimeSeconds) continue;
        if (timeSeconds === track.review.killTimeSeconds) {
          if (secondTimeBits === track.review.killClock)
            track.killWaypoints.push(...encodedWaypoints);
          continue;
        }
        if (!track.creation || timeSeconds < track.creation.creationTimeSeconds)
          throw Error("Neutral objective waypoint predates creation");
        track.observations.push({
          timeSeconds,
          opcode,
          syncId,
          speed: motion?.speed ?? speed,
          encodedWaypoints,
        });
      }
    },
  });

  const footerRow = binding.verified.find(
    ({ context }) => context === actorContext,
  )?.footerRow;
  const metadata = JSON.parse(
    utf8.decode(replay.bytes.subarray(replay.end + 256, -4)),
  );
  const rows = JSON.parse(metadata.statsJson);
  if (
    footerRow !== 2 ||
    rows.length !== 10 ||
    !rows.every(({ BARON_KILLS, RIFT_HERALD_KILLS }, index) =>
      index + 1 === footerRow
        ? BARON_KILLS === "2" && RIFT_HERALD_KILLS === "1"
        : BARON_KILLS === "0" && RIFT_HERALD_KILLS === "0",
    )
  )
    throw Error("Neutral objective kill actor or footer counts differ");

  const actors = [];
  const events = [];
  for (const {
    review,
    creation,
    observations,
    killRecords,
    killWaypoints,
  } of subjects.values()) {
    const { context, modelId, killTimeSeconds } = review;
    // The one-byte opcode 260 recurs during live combat. The synchronized
    // actor, announcement and subject termination witnesses distinguish the kill.
    const witnesses = [
      [702, 0, review.announcement],
      [1197, context, review.terminal],
      [729, context, review.subjectWitness],
      [257, actorContext, review.actor],
    ];
    const seen = witnesses.every(
      ([opcode, scope, body]) =>
        killRecords.filter(
          ([op, id, hex]) => op === opcode && id === scope && hex === body,
        ).length === 1,
    );
    const pairedActor = killRecords.filter(
      ([opcode, scope, body]) =>
        opcode === 682 &&
        scope !== 0 &&
        scope !== actorContext &&
        body === review.actorWitness &&
        body.slice(2) === review.actor.slice(2),
    );
    if (!seen || pairedActor.length !== 1 || !creation || !observations.length)
      throw Error("Incomplete synchronized neutral objective evidence");
    const encodedKillPosition = killWaypoints[0];
    if (
      encodedKillPosition &&
      !killWaypoints.every(
        ([x, z]) =>
          x === encodedKillPosition[0] && z === encodedKillPosition[1],
      )
    )
      throw Error("Ambiguous same-clock neutral objective position");
    events.push({
      subjectContext: context,
      timeSeconds: killTimeSeconds,
      actorContext,
      footerRow,
      modelId,
      ...(encodedKillPosition && { encodedKillPosition }),
    });
    actors.push({
      context,
      modelId,
      ...creation,
      killTimeSeconds,
      observations,
    });
  }
  return { actors, events, creationTableSha256 };
}
