import { sha256 } from "./structural-comparison.mjs";

const imageSha256 =
  "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7";
const arenaBase = 0x10200000;
const swap = (value) => ((value >>> 1) & 0x55) | ((value << 1) & 0xaa);

// Original consumer 0x6cdea0 selects a native slot from row+8 and stores the
// decoded row+0xc0 key at participant+0. The footer names this key SUMMONER_ID;
// footer ID and footer array order are separate identities. Independent original
// instruction execution lives in tools/inspect-participant-consumer.py.
export async function createLatestParticipantReader({ profile, image }) {
  if (
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    profile.decoderImageSha256 !== imageSha256 ||
    (await sha256(image)) !== imageSha256
  )
    throw Error("Pinned original participant consumer image required");
  const table = image.slice(0x20d6660, 0x20d6760);
  if (table.length !== 256 || new Set(table).size !== 256)
    throw Error("Original participant permutation required");
  const slotByte = (value) =>
    table[
      (table[(table[(table[value ^ 0xff] + 0xe5) & 255] + 0x62) & 255] + 0x1c) &
        255
    ];
  const identityByte = (value) =>
    table[swap(((swap(value ^ 0xc0) + 0xa8) & 255) ^ 0xde)];
  return {
    read(observation) {
      const { object, heap } = observation;
      if (
        !observation.complete ||
        !(object instanceof Uint8Array) ||
        object.length !== 568 ||
        !(heap instanceof Uint8Array) ||
        heap.length < 568 ||
        object.some((value, index) => value !== heap[index])
      )
        throw Error(
          "Complete original participant startup observation required",
        );
      const view = new DataView(
        object.buffer,
        object.byteOffset,
        object.byteLength,
      );
      const pointer = view.getBigUint64(0x40, true),
        count = view.getUint32(0x48, true),
        capacity = view.getUint32(0x4c, true);
      if (
        view.getUint16(8, true) !== 728 ||
        view.getUint32(12, true) !== 0 ||
        pointer > BigInt(Number.MAX_SAFE_INTEGER) ||
        count !== 10 ||
        capacity < count ||
        capacity > 65536
      )
        throw Error("Ten original recorded participants required");
      const offset = Number(pointer) - arenaBase;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 568 ||
        offset + count * 0xd0 > heap.length
      )
        throw Error("Participant vector escaped original packet arena");
      const rows = [],
        slots = new Set(),
        identities = new Set();
      for (let index = 0; index < count; index++) {
        const row = heap.subarray(
            offset + index * 0xd0,
            offset + (index + 1) * 0xd0,
          ),
          slot = slotByte(row[8]);
        let key = 0n;
        for (let lane = 0; lane < 8; lane++)
          key |= BigInt(identityByte(row[0xc0 + lane])) << BigInt(lane * 8);
        const summonerId = key.toString();
        if (
          slot < 1 ||
          slot > 10 ||
          slots.has(slot) ||
          key === 0n ||
          identities.has(summonerId)
        )
          throw Error(
            "Unique original participant slots and identities required",
          );
        slots.add(slot);
        identities.add(summonerId);
        rows.push({ slot, summonerId });
      }
      return rows;
    },
  };
}

export function bindLatestHeroParticipant(hero, participants, replay) {
  const rows = participants.filter((row) => row.slot === hero.slot);
  if (rows.length !== 1)
    throw Error("Hero requires one original participant slot");
  const matches = replay.participantSummonerIds.flatMap((key, index) =>
    key === rows[0].summonerId ? [index] : [],
  );
  if (matches.length !== 1)
    throw Error(
      "Original participant SUMMONER_ID must uniquely match replay metadata",
    );
  const metadataIndex = matches[0],
    metadata = replay.roster[metadataIndex];
  if (
    metadata.champion !== hero.champion ||
    ![100, 200].includes(metadata.team)
  )
    throw Error(
      "Original participant identity differs from replay champion/team metadata",
    );
  return {
    team: metadata.team,
    metadataIndex,
    metadataBinding: "recorded-startup-slot-to-footer-summoner-id",
  };
}
