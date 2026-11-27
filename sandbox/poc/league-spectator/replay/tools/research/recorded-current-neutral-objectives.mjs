import { readInventoryReplayFooter } from "./verify-recorded-inventory-footer.mjs";
import {
  recoverTerrainByteSubstitution,
  rotateByteLeft as rotate,
  swapAdjacentBits as swap,
} from "./native-terrain-byte-codecs.mjs";
import { createCurrentLaneMinionPacketReader } from "./recorded-lane-minion-packets.mjs";

const text = new TextDecoder("utf-8", { fatal: true });
const dragonName =
  /^(sru_dragon_(?:air|water|earth|fire|chemtech|hextech))\.6\.1$/;
const campNames = new Map([
  ["SRU_Red", /^(8|17)\.1$/],
  ["SRU_Blue", /^(10|16)\.1$/],
  ["SRU_Razorbeak", /^(14|15)\.1$/],
  ["SRU_RazorbeakMini", /^(14|15)\.[2-6]$/],
  ["SRU_Murkwolf", /^(13|18)\.1$/],
  ["SRU_MurkwolfMini", /^(13|18)\.[23]$/],
  ["SRU_Gromp", /^(2|11)\.1$/],
  ["SRU_Krug", /^(5|7)\.1$/],
  ["SRU_KrugMini", /^(5|7)\.2$/],
  ["Sru_Crab", /^(1|9)\.1$/],
  ["SRU_Horde", /^12\.[1-3]$/],
]);
const footerKeys = {
  dragon: "DRAGON_KILLS",
  baron: "BARON_KILLS",
  herald: "RIFT_HERALD_KILLS",
};
const globalSignals = {
  dragon: [
    [671, [14], 0xc9],
    [702, [18, 19, 20], 0xd5],
    [1076, [10], 0x47],
  ],
  baron: [
    [671, [14], 0xb9],
    [702, [19, 20], 0xe6],
    [1076, [10], 0x3c],
  ],
  herald: [
    [671, [14], 0x60],
    [702, [18, 19, 20], 0x28],
    [1076, [10], 0x41],
  ],
};

export function readCurrentNeutralCreationName(payload, table) {
  const selector = (payload[6] >>> 1) & 3;
  const decode = [
    (byte) => rotate(swap(table[byte]), 1) ^ 0xa6,
    (byte) => rotate(rotate(table[(byte + 0x41) & 0xff], 4) ^ 0xee, 1),
    (byte) => rotate(table[table[rotate(table[byte] ^ 0xa8, 7)]], 1),
  ][selector];
  if (decode === undefined || payload.length <= 27)
    throw Error("Unsupported current neutral creation name framing");
  const length = decode(payload[26]);
  if (length === 0 || length > payload.length - 27)
    throw Error("Invalid current neutral creation name length");
  const name = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    let target = index;
    if (selector === 0) target = length - 1 - index;
    if (selector === 2)
      target = index % 2 ? length - 1 - (index >> 1) : index >> 1;
    name[target] = decode(payload[index + 27]);
  }
  return text.decode(name);
}

function objectiveIdentity(name) {
  if (name === "SRU_Baron") return { kind: "baron", modelId: "sru_baron" };
  if (name === "SRU_RiftHerald.4.1")
    return { kind: "herald", modelId: "sru_riftherald" };
  const dragon = dragonName.exec(name);
  if (dragon !== null) return { kind: "dragon", modelId: dragon[1] };
}

function readCampIdentity(name) {
  const separator = name.indexOf(".");
  if (separator === -1) return;
  const model = name.substring(0, separator);
  const grammar = campNames.get(model);
  if (grammar === undefined) return;
  if (!grammar.test(name.substring(separator + 1))) return null;
  return {
    kind: model === "SRU_Horde" ? "horde" : "camp",
    modelId: model.toLowerCase(),
  };
}

function readFooter(replay, binding, includeCamps) {
  const rows = JSON.parse(readInventoryReplayFooter(replay.bytes).statsJson);
  if (
    !Array.isArray(rows) ||
    rows.length !== 10 ||
    binding.verified.length !== 10
  )
    throw Error(
      "Current objective credits require a complete verified replay roster",
    );
  const owners = new Map(
    binding.verified.map(({ context, footerRow }) => [context, footerRow]),
  );
  const footerIndexes = new Set(owners.values());
  if (
    owners.size !== 10 ||
    footerIndexes.size !== 10 ||
    rows.some((_, i) => !footerIndexes.has(i + 1))
  )
    throw Error(
      "Current objective credits require unique verified replay participants",
    );
  const expected = rows.map((row) => {
    if (row.ELDER_DRAGON_KILLS !== "0")
      throw Error("Current objective evidence does not cover Elder Dragons");
    return Object.fromEntries(
      Object.entries(footerKeys).map(([kind, field]) => {
        const value = row[field];
        if (
          typeof value !== "string" ||
          !/^\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value))
        )
          throw Error("Invalid current objective footer count");
        return [kind, Number(value)];
      }),
    );
  });
  const horde = includeCamps
    ? rows.map(({ HORDE_KILLS: value }) => {
        if (
          typeof value !== "string" ||
          !/^\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value))
        )
          throw Error("Invalid current Horde footer count");
        return Number(value);
      })
    : undefined;
  return { owners, expected, horde };
}

function resolveEvent(actor, globals, owners, durationSeconds) {
  const { terminal, removal, context, creationTimeSeconds, kind, modelId } =
    actor;
  if (terminal === undefined && removal === undefined) return;
  const footerRow = owners.get(terminal?.actorContext);
  if (
    terminal === undefined ||
    removal === undefined ||
    footerRow === undefined ||
    terminal.timeSeconds <= creationTimeSeconds ||
    removal.timeSeconds <= terminal.timeSeconds ||
    removal.timeSeconds > durationSeconds ||
    removal.entity !== context
  )
    throw Error("Current objective terminal, removal or actor is unresolved");
  const witnesses = globals.get(terminal.secondTimeBits) ?? [];
  if (
    !globalSignals[kind].every(
      ([opcode, widths, last]) =>
        witnesses.filter(
          (row) =>
            row.timeSeconds === terminal.timeSeconds &&
            row.opcode === opcode &&
            widths.includes(row.length) &&
            row.last === last,
        ).length === 1,
    )
  )
    throw Error(
      "Missing synchronized current objective global event witnesses",
    );
  const killPoints = actor.observations
    .filter(
      ({ timeSeconds, secondTimeBits }) =>
        timeSeconds === terminal.timeSeconds &&
        secondTimeBits === terminal.secondTimeBits,
    )
    .flatMap(({ encodedWaypoints }) => encodedWaypoints);
  const encodedKillPosition = killPoints[0];
  const exactPosition =
    encodedKillPosition !== undefined &&
    killPoints.every(
      ([x, z]) => x === encodedKillPosition[0] && z === encodedKillPosition[1],
    );
  return {
    subjectContext: context,
    ...terminal,
    footerRow,
    modelId,
    kind,
    ...(exactPosition ? { encodedKillPosition } : {}),
  };
}

/** Read only complete synchronized pit-objective evidence from the current ROFL. */
export function createCurrentNeutralObjectiveCollector({
  replay,
  binding,
  codecs,
  readWaypoints,
  onBirth,
  includeCamps = false,
  onCampBirth,
}) {
  const readPacket = createCurrentLaneMinionPacketReader(replay, codecs);
  const table = recoverTerrainByteSubstitution(codecs);
  const { owners, expected, horde } = readFooter(replay, binding, includeCamps);
  const actors = new Map();
  const camps = new Map();
  let unsupportedCampNames = 0;
  const globals = new Map();
  let opcode = null;
  let context = 0;
  function observe(packet) {
    if (packet.stream !== 1) return;
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    const { payload, timeSeconds, secondTimeBits } = packet;
    if (timeSeconds > replay.duration) return;
    if (
      context === 0 &&
      (opcode === 671 || opcode === 702 || opcode === 1076)
    ) {
      const rows = globals.get(secondTimeBits) ?? [];
      rows.push({
        timeSeconds,
        opcode,
        length: payload.length,
        last: payload.at(-1),
      });
      globals.set(secondTimeBits, rows);
    } else if (opcode === 392) {
      const objectName = readCurrentNeutralCreationName(payload, table);
      const objective = objectiveIdentity(objectName);
      const identity =
        objective ?? (includeCamps ? readCampIdentity(objectName) : undefined);
      if (identity === null) {
        unsupportedCampNames++;
        return;
      }
      if (identity === undefined) return;
      if (
        actors.has(context) ||
        camps.has(context) ||
        context === 0 ||
        owners.has(context)
      )
        throw Error("Duplicate or invalid current objective context");
      (objective === undefined ? camps : actors).set(context, {
        context,
        objectName,
        ...identity,
        creationTimeSeconds: timeSeconds,
        observations: [],
      });
      if (objective === undefined) onCampBirth?.(context, timeSeconds);
      else onBirth?.(context, timeSeconds);
    } else if (opcode === 96 || opcode === 1174) {
      const { records, syncId } = readWaypoints(opcode, payload);
      for (const { entityId, motion, speed, encodedWaypoints } of records) {
        const actor = actors.get(entityId) ?? camps.get(entityId);
        if (
          actor &&
          (!actor.terminal || timeSeconds <= actor.terminal.timeSeconds)
        )
          actor.observations.push({
            timeSeconds,
            secondTimeBits,
            opcode,
            syncId,
            speed: motion?.speed ?? speed,
            encodedWaypoints,
          });
      }
    } else if (opcode === 1197 || opcode === 117) {
      const actor = actors.get(context) ?? camps.get(context);
      if (actor === undefined) return;
      const result = readPacket(opcode, payload);
      const field = opcode === 1197 ? "terminal" : "removal";
      if (actor[field] !== undefined) {
        if (actor.kind !== "camp")
          throw Error(`Repeated current objective ${field} packet`);
        actor.ambiguousLifecycle = true;
        return;
      }
      if (opcode === 1197) {
        actor.terminal = {
          timeSeconds,
          secondTimeBits,
          actorContext: result.relatedEntity,
        };
      } else {
        actor.removal = {
          timeSeconds,
          entity: result.entity,
        };
      }
    }
  }
  function finish() {
    const events = [];
    const clocks = new Set();
    const rendered = [];
    const remaining = expected.map((row) => ({ ...row }));
    for (const actor of actors.values()) {
      const event = resolveEvent(actor, globals, owners, replay.duration);
      if (event !== undefined) {
        if (clocks.has(event.secondTimeBits))
          throw Error("Current objectives share a terminal event clock");
        clocks.add(event.secondTimeBits);
        remaining[event.footerRow - 1][event.kind]--;
        events.push(event);
      }
      const { terminal, removal, observations, ...identity } = actor;
      rendered.push({
        ...identity,
        killTimeSeconds: terminal?.timeSeconds ?? null,
        removalTimeSeconds: removal?.timeSeconds ?? null,
        observations: observations.filter(
          ({ timeSeconds }) =>
            terminal === undefined || timeSeconds < terminal.timeSeconds,
        ),
      });
    }
    if (
      remaining.some((row) => Object.values(row).some((count) => count !== 0))
    )
      throw Error("Current objective credits differ from the replay footer");
    const major = {
      actors: rendered,
      events: events.toSorted((a, b) => a.timeSeconds - b.timeSeconds),
    };
    if (!includeCamps) return major;
    const campActors = [];
    const hordeEvents = [];
    const campCoverage = {
      births: camps.size + unsupportedCampNames,
      closed: 0,
      open: 0,
      omissions: {
        unsupportedCampNames,
        incompleteLifecycle: 0,
        missingRecordedMotion: 0,
      },
    };
    const remainingHorde = [...horde];
    for (const {
      terminal,
      removal,
      observations,
      ambiguousLifecycle,
      ...identity
    } of camps.values()) {
      const { context, creationTimeSeconds, modelId, kind } = identity;
      if (terminal === undefined && removal === undefined) campCoverage.open++;
      else if (
        !ambiguousLifecycle &&
        terminal !== undefined &&
        removal !== undefined &&
        creationTimeSeconds < terminal.timeSeconds &&
        terminal.timeSeconds < removal.timeSeconds &&
        removal.timeSeconds <= replay.duration &&
        removal.entity === context
      )
        campCoverage.closed++;
      else {
        campCoverage.omissions.incompleteLifecycle++;
        continue;
      }
      if (kind === "horde" && terminal !== undefined) {
        const footerRow = owners.get(terminal.actorContext);
        if (footerRow === undefined || remainingHorde[footerRow - 1] <= 0)
          throw Error(
            "Current Horde terminal actor differs from the replay footer",
          );
        remainingHorde[footerRow - 1]--;
        hordeEvents.push({
          subjectContext: context,
          actorContext: terminal.actorContext,
          footerRow,
          modelId,
          kind,
          timeSeconds: terminal.timeSeconds,
          secondTimeBits: terminal.secondTimeBits,
        });
      }
      const retained = observations.filter(
        ({ timeSeconds, encodedWaypoints }) =>
          encodedWaypoints.length > 0 &&
          timeSeconds >= creationTimeSeconds &&
          timeSeconds < (terminal?.timeSeconds ?? replay.duration),
      );
      if (retained.length === 0) campCoverage.omissions.missingRecordedMotion++;
      campActors.push({
        ...identity,
        killTimeSeconds: terminal?.timeSeconds ?? null,
        removalTimeSeconds: removal?.timeSeconds ?? null,
        observations: retained,
      });
    }
    if (remainingHorde.some((count) => count !== 0))
      throw Error("Current Horde credits differ from the replay footer");
    return {
      ...major,
      campActors,
      hordeEvents: hordeEvents.toSorted(
        (a, b) => a.timeSeconds - b.timeSeconds,
      ),
      campCoverage,
    };
  }
  return { observe, finish };
}
