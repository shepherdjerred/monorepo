import { assertExactTerrainReplay } from "./native-terrain-byte-codecs.mjs";

const rotate = (byte, by) => ((byte << by) | (byte >>> (8 - by))) & 0xff;
const swap = (byte) => ((byte >>> 1) & 0x55) | ((byte << 1) & 0xaa);
const utf8 = new TextDecoder("utf-8", { fatal: true });

function terrainSubstitution(codecs) {
  if (typeof codecs?.decodeSyncByte !== "function")
    throw Error(
      "Verified exact terrain byte codecs required for champion identity",
    );
  // Invert the outer operations of the admitted sync codec to recover its
  // shared byte substitution. Opcode 88 references the same table.
  return (index) => {
    const output = codecs.decodeSyncByte((index - 0x64) & 0xff);
    return rotate((output - 0xed) & 0xff, 2) ^ 0xff;
  };
}

/** Read identity and optionally the authored skin selection from the exact hero factory. */
export function createNativeTerrainChampionCreation88Reader(
  replay,
  codecs,
  options,
) {
  assertExactTerrainReplay(replay, options);
  const substitute = terrainSubstitution(codecs);
  const decodeOptionalScalar = (byte) =>
    rotate(
      ((swap(substitute(rotate(byte ^ 0x61, 3))) + 0x68) & 0xff) ^ 0x18,
      3,
    );
  const decodeChampion = [
    null,
    (byte) =>
      substitute(
        (substitute((rotate(byte ^ 0xff, 6) + 0x49) & 0xff) + 0xc1) & 0xff,
      ),
    (byte) => rotate((byte + 0xfc) & 0xff, 2) ^ 0xa1,
    (byte) => (swap(substitute((byte + 0x82) & 0xff)) + 0x13) & 0xff,
  ];
  const decodeSkinLength = [
    (byte) => (substitute(swap(rotate(byte, 7))) + 0xe7) & 0xff,
    (byte) =>
      (rotate(substitute(swap((rotate(byte, 2) + 0xfc) & 0xff)) ^ 0xff, 7) +
        0xe1) &
      0xff,
    null,
    (byte) =>
      rotate(
        substitute(
          ((rotate(((byte ^ 0xb0) + 0x48) & 0xff, 4) ^ 0x68) + 0xda) & 0xff,
        ),
        5,
      ),
  ];

  return function readChampionCreation(payload, { includeSkin = false } = {}) {
    if (!(payload instanceof Uint8Array) || payload.length < 6)
      throw Error("Truncated opcode 88 hero creation");
    const [flag0, flag1, flag2, flag3, flag4, flag5] = payload;
    // The opening hero-creation form uses the default early scalar fields,
    // a 12-byte position, and explicit trailing one-byte and 12-byte fields.
    if (
      (flag0 & 0xc7) !== 7 ||
      (flag1 & 0x7f) !== 8 ||
      (flag2 & 0xfc) !== 0xa4 ||
      (flag3 & 0x83) !== 0x80 ||
      (flag4 & 0x7f) !== 0x4a ||
      (flag5 & 0xf0) !== 0x10
    )
      throw Error("Unsupported opcode 88 opening hero creation form");

    // The early byte at object +0x23 is supplied by the stream only in
    // branches 1, 5, 6, and 7 of the native jump table at 0x10611f4.
    const earlyByteMode = (flag0 >>> 3) & 7;
    let cursor = 19 + Number([1, 5, 6, 7].includes(earlyByteMode));
    function readVarUint(decode, terminalBit = 0) {
      let value = 0;
      for (let shift = 0; shift < 35 && cursor < payload.length; shift += 7) {
        const byte = decode(payload[cursor++]);
        value += (byte & 0x7f) * 2 ** shift;
        if (value > 0xffffffff) break;
        if ((byte & 0x80) === terminalBit) return value;
      }
      throw Error("Truncated or out-of-range opcode 88 hero creation field");
    }

    const optionalScalar = (flag4 >>> 7) | ((flag5 & 3) << 1);
    // The native jump table at 0x1061274 writes the default at object +0x34,
    // or reads the wire varuint. The hero factory decodes +0x34 at 0x6f8943,
    // and the Characters resource lookup at 0x2c1790 stores it with the name.
    const implicitSkin = [2, null, null, 0xffffffff, 1, null, 0, null][
      optionalScalar
    ];
    const skinId = implicitSkin ?? readVarUint(decodeOptionalScalar);
    const optionalByte = (flag1 >>> 7) | ((flag2 & 3) << 1);
    if ([0, 2, 3, 6].includes(optionalByte)) cursor++;

    // Native string readers at 0x1061b80, 0x1061c80, and 0x10f67f0.
    const championMode = (flag5 >>> 2) & 3;
    const decode = decodeChampion[championMode];
    if (!decode) throw Error("Missing opcode 88 champion identifier");
    const length = readVarUint(decode);
    if (length === 0 || length > 128 || cursor + length > payload.length)
      throw Error("Invalid opcode 88 champion identifier width");
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      const target =
        championMode === 3
          ? index & 1
            ? length - 1 - (index >>> 1)
            : index >>> 1
          : index;
      bytes[target] = decode(payload[cursor++]);
    }
    const champion = utf8.decode(bytes);
    if (!/^[A-Za-z0-9_]+$/.test(champion))
      throw Error("Invalid opcode 88 champion identifier");

    // All explicit identity selectors use the same seven-bit transform with
    // a set sign bit terminating the compact context.
    const contextMode = (flag3 >>> 4) & 7;
    if (contextMode === 2 || contextMode === 6)
      throw Error("Missing opcode 88 hero context");
    const id = readVarUint(
      (byte) => (((rotate(byte ^ 0xff, 2) ^ 0xf1) + 0xfa) & 0xff) ^ 0x0a,
      0x80,
    );
    const context = id & 0xffffff ? (id ^ 0x40000000) >>> 0 : id;
    if (!context) throw Error("Invalid opcode 88 hero context");

    const skinLength = decodeSkinLength[(flag3 >>> 2) & 3];
    if (skinLength) {
      const skippedBytes = readVarUint(skinLength);
      cursor += skippedBytes;
    }
    if (cursor + 13 !== payload.length)
      throw Error(
        `Invalid opcode 88 hero creation width (${cursor + 13} for ${payload.length} bytes)`,
      );
    return includeSkin ? { context, champion, skinId } : { context, champion };
  };
}

/** Corroborate actor identities by opening creation and independent team packets. */
export function bindNativeTerrainChampionIdentities(prepared, codecs, options) {
  const { packetReader, observations } = prepared;
  assertExactTerrainReplay(observations, options);
  if (
    packetReader.build !== observations.build ||
    packetReader.protocol !== observations.protocol
  )
    throw Error("Champion identities disagree about replay build or protocol");
  const readCreation = createNativeTerrainChampionCreation88Reader(
    packetReader,
    codecs,
    options,
  );
  const substitute = terrainSubstitution(codecs);
  const decodeTeamByte = (byte) =>
    substitute(rotate(((0x91 - byte) & 0xff) ^ 0xd4, 1)) ^ 0x7f;
  const { keyframe, packets } = packetReader.read(0);
  if (keyframe.timeSeconds !== 0)
    throw Error("Expected a time-zero keyframe for champion identities");
  const teams = new Map();
  const creations = new Map();
  let opcode = null;
  let context = 0;
  for (const packet of packets) {
    if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset)
      break;
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode === 88) {
      if (context !== 0) throw Error("Unexpected opcode 88 envelope context");
      const creation = readCreation(packet.payload);
      if (creations.has(creation.context))
        throw Error("Duplicate opcode 88 hero context");
      creations.set(creation.context, creation.champion);
    } else if (opcode === 313) {
      const { payload } = packet;
      if (
        payload.length !== 1263 ||
        payload[0] !== 0x91 ||
        decodeTeamByte(payload[1]) !== 0xec ||
        decodeTeamByte(payload[2]) !== 9 ||
        teams.has(context)
      )
        throw Error("Invalid opening opcode 313 team record");
      // The vector reader 0x10f4360 reverses the 1260 decoded bytes. The
      // team at vector offset 32 is therefore wire byte 1230.
      const team = decodeTeamByte(payload[1230]);
      if (team !== 100 && team !== 200)
        throw Error("Unsupported opening opcode 313 team");
      teams.set(context, team);
    }
  }

  const { binding, roster } = observations;
  const known = new Map(
    binding.verified.map(({ context, footerRow }) => [context, footerRow]),
  );
  const expected = new Set([...known.keys(), ...binding.unresolved]);
  if (
    expected.size !== roster.length ||
    teams.size !== expected.size ||
    [...teams.keys()].some((context) => !expected.has(context)) ||
    [...creations.keys()].some((context) => !teams.has(context))
  )
    throw Error(
      "Opening champion identities disagree with verified replay contexts",
    );

  const matches = new Map();
  for (const [context, champion] of creations) {
    const team = teams.get(context);
    const candidates = roster.flatMap((row, index) =>
      row.team === team && row.champion === champion ? [index + 1] : [],
    );
    if (candidates.length === 0)
      throw Error("Opcode 88 champion is absent from its team's footer");
    if (known.has(context) && !candidates.includes(known.get(context)))
      throw Error("Opcode 88 and combat participant evidence disagree");
    if (candidates.length === 1) {
      const footerRow = candidates[0];
      if (matches.has(footerRow))
        throw Error("Duplicate opcode 88 hero claim on one footer participant");
      matches.set(footerRow, context);
    }
  }
  const claimed = new Set(known.values());
  for (const [footerRow, context] of matches) {
    if (known.has(context)) continue;
    if (claimed.has(footerRow))
      throw Error("Opcode 88 conflicts with a bound footer participant");
    known.set(context, footerRow);
    claimed.add(footerRow);
  }
  const verified = [...expected]
    .filter((context) => known.has(context))
    .map((context) => ({ context, footerRow: known.get(context) }));
  const unresolved = [...expected].filter((context) => !known.has(context));
  return {
    binding: { ...binding, verified, unresolved },
    coverage: {
      openingCreations: creations.size,
      independentlyMatched: matches.size,
      corroboratedCombatMatches: binding.verified.filter(
        ({ context, footerRow }) => matches.get(footerRow) === context,
      ).length,
      unresolved: unresolved.length,
    },
  };
}
