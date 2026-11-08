// Field interpretation follows the exact-build RoflLens profiles (see license notice).
const HEAP = 0x10200000;
const f32bits = new DataView(new ArrayBuffer(4));
const float = (bits) => {
  f32bits.setUint32(0, bits, true);
  const v = f32bits.getFloat32(0, true);
  if (!Number.isFinite(v)) throw Error("Non-finite gameplay field");
  return v;
};
function last(writes, offset, byte = false) {
  const values = writes.filter(
    ([o, size]) => o === offset && (byte ? size === 1 : size !== 1),
  );
  if (!values.length)
    throw Error(`Missing decoded field 0x${offset.toString(16)}`);
  return Number(
    BigInt.asUintN(
      32,
      values[
        byte && values.length > 1 ? values.length - 2 : values.length - 1
      ][2],
    ),
  );
}
function captured(writes, offset, index) {
  const counts = new Uint32Array(1024);
  for (const [o, size, value] of writes) {
    if (size === 1) continue;
    if (o === offset && counts[o] === index)
      return Number(BigInt.asUintN(32, value));
    for (let i = o; i < Math.min(o + size, 1024); i++) counts[i]++;
  }
  throw Error("Missing captured gameplay write");
}
function string(o, pointerOffset, lengthOffset) {
  const d = new DataView(o.output.buffer),
    pointer = Number(d.getBigUint64(pointerOffset, true)),
    size = d.getUint32(lengthOffset, true);
  if (!size) return "";
  const start = pointer - HEAP;
  if (size > 65536 || start < 0 || start + size > o.heap.length)
    throw Error("Gameplay string outside private heap");
  return new TextDecoder("utf-8", { fatal: true }).decode(
    o.heap.subarray(start, start + size),
  );
}
export function decodeGameplay(engine, packet) {
  const { opcode, payload, time, param } = packet;
  if (opcode === 411) {
    if (payload.length !== 1 || payload[0] !== 0xe8)
      throw Error("Unknown lifecycle-end marker");
    return { kind: "remove", time, entityId: param };
  }
  const name = {
    107: "replication",
    921: "buffAdd",
    398: "buffRemove",
    259: "buffUpdateCount",
    351: "buffUpdateNumCounter",
    197: "spellCast",
    879: "championDeath",
    550: "wardSpawnOrDestroy",
    751: "missileTrajectory",
    861: "opcode035dCandidate",
    330: "minionSpawn",
    181: "basicAttack",
    781: "minionAttack",
    908: "attackPosition",
    1133: "minionAttackPosition",
    386: "neutralSpawn",
    815: "turretSpawn",
    1012: "respawn",
    1224: "reincarnate",
    487: "unitDeath",
    343: "unitDeathBroadcast",
    280: "buildingDeath",
  }[opcode];
  if (!name) throw Error(`Unsupported gameplay opcode ${opcode}`);
  const o = engine.observe(name, payload, {
      constructorWrites: opcode === 197,
    }),
    c = engine.profile.decoders[name];
  const n = (k) => {
    if (c[k] === undefined)
      throw Error(`Missing field definition ${name}/${k}`);
    return Number(c[k]);
  };
  const uint = (k) => last(o.writes, n(k)),
    number = (k) => float(uint(k)),
    byte = (k) => last(o.writes, n(k), true) & 255;
  const vector = (k) =>
    c[k].map((offset) => float(last(o.writes, Number(offset))));
  if (opcode === 107) {
    const view = new DataView(o.output.buffer);
    const start = Number(view.getBigUint64(24, true)) - HEAP;
    const length = view.getUint32(32, true);
    if (start < 0 || start + length > o.heap.length)
      throw Error("Replication vector outside private heap");
    return {
      kind: "stats",
      time,
      ...parseReplication(
        o.heap.subarray(start, start + length),
        c.healthFields,
      ),
    };
  }
  const raw = (offset) => last(o.writes, offset),
    scalar = (offset) => float(raw(offset)),
    octet = (offset) => last(o.writes, offset, true) & 255;
  const firstByte = (k) => {
    const field = o.writes.find(([offset]) => offset === n(k));
    if (!field) throw Error(`Missing buff field ${k}`);
    return Number(BigInt.asUintN(8, field[2]));
  };
  if (opcode === 921)
    return {
      kind: "buffAdd",
      time,
      entityId: param,
      slot: firstByte("buffSlotOffset"),
      type: firstByte("buffTypeOffset"),
      count: firstByte("countOffset"),
      nameHash: uint("buffNameHashOffset"),
      casterId: uint("casterObjectIdOffset"),
      duration: number("durationOffset"),
      runningTime: number("runningTimeOffset"),
      packageHash: uint("packageHashOffset"),
    };
  if (opcode === 398)
    return {
      kind: "buffRemove",
      time,
      entityId: param,
      slot: firstByte("buffSlotOffset"),
      nameHash: uint("buffNameHashOffset"),
    };
  if (opcode === 259 || opcode === 351)
    return {
      kind: "buffCount",
      time,
      entityId: param,
      slot: firstByte("buffSlotOffset"),
      count:
        opcode === 259 ? firstByte("countOffset") : uint("counterOffset") | 0,
      counterKind: opcode === 259 ? "stacks" : "numeric",
    };
  if ([181, 781, 908, 1133].includes(opcode)) {
    const offset = opcode === 1133 ? 16 : opcode === 908 ? 8 : 0;
    return {
      kind: "attack",
      time,
      entityId: param,
      targetId: raw(0x18 + offset),
      targetPosition: [
        scalar(0x20 + offset),
        scalar(0x24 + offset),
        scalar(0x28 + offset),
      ],
      missileId: raw(0x44 + offset),
      rawAnimation: raw(0x40 + offset),
    };
  }
  if (opcode === 330)
    return {
      kind: "minion",
      time,
      entityId: raw(0x10),
      barracksId: raw(0x20),
      minionType: octet(0x24),
      laneIndex: raw(0x1a),
      rawFlags: octet(0x18),
    };
  if (opcode === 386)
    return {
      kind: "neutral",
      time,
      entityId: param,
      name: string(o, 0xa0, 0xa8),
      instanceName: string(o, 0x28, 0x30),
      position: [scalar(0x40), scalar(0x44), scalar(0x48)],
      facingPosition: [scalar(0x90), scalar(0x94), scalar(0x98)],
    };
  if (opcode === 815)
    return {
      kind: "turret",
      time,
      entityId: raw(0x10),
      instanceName: string(o, 0x28, 0x30),
      name: string(o, 0x40, 0x48),
    };
  if ([1012, 1224].includes(opcode))
    return {
      kind: "respawn",
      time,
      entityId: param,
      position: [scalar(0x10), scalar(0x14)],
      rawValue: scalar(0x18),
    };
  if ([487, 343, 280].includes(opcode))
    return { kind: "unitDeath", time, entityId: param };
  if (opcode === 879)
    return {
      kind: "death",
      time,
      victimId: last(
        o.writes,
        n("victimRecordOffset") + n("recordEntityIdOffset"),
      ),
      killerId: uint("killerIdOffset"),
    };
  if (opcode === 861)
    return {
      kind: "forceMissile",
      time,
      entityId: uint("valueOffset"),
      sourceId: param,
    };
  if (opcode === 550)
    return {
      kind: "spawn",
      time,
      entityId: captured(o.writes, n("idOffset"), n("idWriteCount")),
      ownerId: captured(o.writes, n("ownerIdOffset"), n("ownerIdWriteCount")),
      position: [
        float(captured(o.writes, n("xOffset"), n("xWriteCount"))),
        float(captured(o.writes, n("yOffset"), n("yWriteCount"))),
      ],
      name: string(o, n("namePointerOffset"), n("nameLengthOffset")),
      displayName: string(
        o,
        n("displayNamePointerOffset"),
        n("displayNameLengthOffset"),
      ),
    };
  if (opcode === 751)
    return {
      kind: "missile",
      time,
      entityId: uint("missileIdOffset"),
      sourceId: uint("sourceObjectIdOffset"),
      ownerId: uint("ownerIdOffset"),
      sourceName: string(
        o,
        n("sourceNamePointerOffset"),
        n("sourceNameLengthOffset"),
      ),
      speed: number("speedOffset"),
      spellHash: uint("spellNameHashOffset"),
      missileHash: uint("missileNameHashOffset"),
      source: vector("sourcePositionOffsets"),
      start: vector("startPositionOffsets"),
      end: vector("endPositionOffsets"),
      direction: vector("directionOffsets"),
      embeddedTime: number("embeddedTimestampOffset"),
    };
  const targets = [],
    count = uint("targetCountOffset");
  if (count > 32) throw Error("Invalid spell target count");
  const pointer =
    Number(
      new DataView(o.output.buffer).getBigUint64(
        n("targetPointerOffset"),
        true,
      ),
    ) - HEAP;
  for (let i = 0; i < count; i++) {
    const offset = pointer + i * n("targetRecordSize");
    if (offset < 0 || offset + n("targetRecordSize") > o.heap.length)
      throw Error("Spell target outside private heap");
    targets.push({
      entityId: last(o.heapWrites, offset + n("targetObjectIdOffset")),
      hit: last(o.heapWrites, offset + n("targetHitResultOffset"), true) & 255,
    });
  }
  return {
    kind: "cast",
    time,
    entityId: uint("casterObjectIdOffset"),
    ownerId: uint("spellChainOwnerObjectIdOffset"),
    sourceName: string(
      o,
      n("sourceNamePointerOffset"),
      n("sourceNameLengthOffset"),
    ),
    spellHash: uint("spellHashOffset"),
    slot: byte("spellSlotOffset"),
    flags: byte("flagsOffset"),
    level: uint("spellLevelOffset") & 65535,
    attackSpeed: number("attackSpeedModifierOffset"),
    castId: uint("castNetIdOffset"),
    missileId: uint("missileNetIdOffset"),
    targets,
    startTime: number("startCastTimeOffset"),
    castTime: number("designerCastTimeOffset"),
    extraCastTime: number("extraCastTimeOffset"),
    totalTime: number("designerTotalTimeOffset"),
    positions: c.rawPositionOffsets.map((offsets) =>
      offsets.map((offset) => float(last(o.writes, Number(offset)))),
    ),
    direction: vector("directionOffsets"),
  };
}

// Exact 16.14 decoded-vector grammar. Only the first six fields of group 32
// are interpreted; other length-delimited fields remain counted diagnostics.
function parseReplication(data, names) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = 0,
    records = 0,
    uninterpretedGroups = 0;
  const updates = [];
  const requireBytes = (n) => {
    if (cursor + n > data.length) throw Error("Truncated replication record");
  };
  while (cursor < data.length) {
    requireBytes(5);
    const groups = data[cursor++],
      entityId = view.getUint32(cursor, true);
    cursor += 4;
    if (groups & 128) throw Error("Unknown replication group mask");
    const values = {};
    for (const group of [1, 2, 4, 8, 16, 32, 64]) {
      if (!(groups & group)) continue;
      requireBytes(5);
      const mask = view.getUint32(cursor, true),
        length = data[cursor + 4];
      cursor += 5;
      requireBytes(length);
      const end = cursor + length;
      if (group === 32 && entityId >= 0x400000ae && entityId <= 0x400000b7) {
        for (let bit = 0; bit < 6; bit++) {
          if (!((mask >>> bit) & 1)) continue;
          if (cursor >= end) throw Error("Truncated health field");
          let value;
          if (data[cursor] === 255) {
            value = 0;
            cursor++;
          } else {
            if (data[cursor] === 254) cursor++;
            if (cursor + 4 > end) throw Error("Truncated health float");
            value = view.getFloat32(cursor, true);
            cursor += 4;
          }
          if (!Number.isFinite(value) || value < 0 || value > 10000000)
            throw Error(
              `Invalid observed health/shield ${value}, entity=${entityId.toString(16)} bit=${bit} mask=${mask.toString(16)} bytes=${Array.from(data.subarray(cursor - 4, end))}`,
            );
          values[names[bit]] = value;
        }
        if (mask >>> 6) uninterpretedGroups++;
      } else uninterpretedGroups++;
      cursor = end;
    }
    if (Object.keys(values).length) updates.push({ entityId, ...values });
    records++;
  }
  return { updates, records, uninterpretedGroups };
}
