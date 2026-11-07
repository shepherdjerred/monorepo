import { readMovementRecords } from "./movement-records.mjs";
import { readCastIndexedOverrideCount } from "./latest-cast-indexed-overrides.mjs";

// Candidate meanings are deliberately separate from verified byte execution.
// No fixture hash, fixed network IDs, or assumed map origin belongs here.
export function createLatestFieldReader(profile, fieldCodecs) {
  if (
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    fieldCodecs.schema !== 1 ||
    fieldCodecs.status !== "field-candidate" ||
    fieldCodecs.clientVersion !== profile.clientVersion ||
    fieldCodecs.protocolDigest !== profile.protocolDigest ||
    fieldCodecs.sliceSha256 !== profile.sliceSha256 ||
    fieldCodecs.decoderImageSha256 !== profile.decoderImageSha256
  )
    throw Error("Latest field-codec package mismatch");
  for (const codec of Object.values(fieldCodecs.codecs)) {
    if (
      !Array.isArray(codec.decode) ||
      codec.decode.length !== codec.bytes ||
      codec.decode.some(
        (column) =>
          !Array.isArray(column) ||
          column.length !== 256 ||
          new Set(column).size !== 256 ||
          !column.every((v) => Number.isInteger(v) && v >= 0 && v < 256),
      )
    )
      throw Error("Invalid field byte permutation");
  }
  const decoded = (object, offset, name, size) => {
    const codec = fieldCodecs.codecs[name];
    if (codec?.bytes !== size || offset + size > object.length)
      throw Error(`Invalid field codec ${name}`);
    return Uint8Array.from(
      object.subarray(offset, offset + size),
      (value, lane) => codec.decode[lane][value],
    );
  };
  const view = (bytes) =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packet = (observation, opcode, size) => {
    if (
      !observation.complete ||
      observation.object.length !== size ||
      view(observation.object).getUint32(8, true) !== opcode
    )
      throw Error(`Incomplete or incompatible packet observation ${opcode}`);
    return view(observation.object);
  };
  const vector = (observation, pointer, size) => {
    const offset = Number(pointer) - 0x10200000;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + size > observation.heap.length
    )
      throw Error("Decoded vector outside packet arena");
    return observation.heap.subarray(offset, offset + size);
  };
  const castData = (observation, opcode, size, base) => {
    const data = packet(observation, opcode, size),
      object = observation.object,
      uint = (at, name) =>
        view(decoded(object, base + at, name, 4)).getUint32(0, true),
      length = data.getUint32(base + 280, true);
    if (length > 128) throw Error("Invalid cast source identifier");
    const sourceName = length
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            vector(observation, data.getBigUint64(base + 272, true), length),
          )
        : null,
      attackSpeedModifier = view(
        decoded(object, base + 20, "castAttackSpeedModifier", 4),
      ).getFloat32(0, true),
      target = view(decoded(object, base + 48, "castTargetPosition", 12)),
      targetPosition = [0, 4, 8].map((at) => target.getFloat32(at, true)),
      source = view(decoded(object, base + 32, "castSourcePosition", 12)),
      sourcePosition = [0, 4, 8].map((at) => source.getFloat32(at, true)),
      sourceFlags = decoded(object, base + 216, "castSourceFlags", 1)[0],
      overrideFlag14d = decoded(object, base + 68, "castOverrideFlag14d", 1)[0],
      overrideScalar134 = view(
        decoded(object, base + 208, "castOverrideScalar134", 4),
      ).getFloat32(0, true),
      targetCount = data.getUint32(base + 128, true),
      targetEntries = targetCount
        ? vector(
            observation,
            data.getBigUint64(base + 120, true),
            targetCount * 16,
          )
        : new Uint8Array();
    if (
      !Number.isFinite(attackSpeedModifier) ||
      !Number.isFinite(overrideScalar134) ||
      !targetPosition.every(Number.isFinite) ||
      !sourcePosition.every(Number.isFinite)
    )
      throw Error("Non-finite cast speed modifier or position");
    return {
      sourceName,
      spellHash: uint(64, "castSpellHash"),
      ownerId: uint(80, "castOwnerId"),
      netId48: uint(72, "castNetId48"),
      networkId: uint(220, "castNetworkId"),
      castSequence: uint(168, "castSequence"),
      spellLevel: view(decoded(object, base + 160, "castLevel", 2)).getInt16(
        0,
        true,
      ),
      attackSpeedModifier,
      targetPosition,
      sourcePosition,
      sourceFlags,
      // Neutral names retain the converter's normalized offsets. The missile
      // manager uses their conjunction to bypass ordinary cast-plane placement.
      overrideFlag14d,
      overrideScalar134,
      // Original converter82c360 consumes this plain decoded count, before
      // inserting indexed scalar overrides. Nonempty lists stay untranslated.
      indexedOverrideCount: readCastIndexedOverrideCount(object, base),
      // Converter 0x82abe4..0x82af26 expands 16-byte entries into its target
      // records; 0x829cd0 returns zero when this count is zero. IDs within
      // nonempty entries remain encoded and are retained explicitly.
      targetCount,
      uninterpretedTargetEntries: Array.from(targetEntries, (n) =>
        n.toString(16).padStart(2, "0"),
      ).join(""),
      // Converter 0x82b395..0x82b3a0 writes normalized +0x150.
      // Start initializer 0x874d50 uses recorded +0xc8 when this is true;
      // otherwise it may use the caster, terrain and attachment bone.
      forceRecordedSourcePosition: (sourceFlags & 8) === 0,
    };
  };
  return {
    missileEvent(observation) {
      const opcode = view(observation.object).getUint32(8, true);
      if (![56, 99, 497].includes(opcode))
        throw Error("Wrong missile event-family opcode");
      const data = packet(
          observation,
          opcode,
          { 56: 20, 99: 24, 497: 16 }[opcode],
        ),
        common = {
          opcode,
          entityId: data.getUint32(12, true),
          referenceVerified: false,
          scope:
            "Native missile subscriber; target class is unresolved until identity binding",
        };
      if (opcode === 56)
        return {
          ...common,
          kind: "missile-phase-target",
          target: decoded(observation.object, 16, "missilePhaseTarget", 1)[0],
          semantics:
            "Native callback advances the phase counter to at least this target; this is not an unconditional delete",
        };
      if (opcode === 99)
        return {
          ...common,
          kind: "missile-presentation-byte-candidate",
          value: decoded(
            observation.object,
            16,
            "missilePresentationByte",
            1,
          )[0],
          uninterpretedObjectTail: Array.from(
            observation.object.subarray(17),
            (v) => v.toString(16).padStart(2, "0"),
          ).join(""),
          semantics:
            "Native virtual method writes entity byte 0x90 and forwards it to presentation; bit meanings unresolved",
        };
      return {
        ...common,
        kind: "missile-stop-candidate",
        semantics:
          "Native callback zeros velocity, stops a presentation interface and sets flag 0x3c8; memory removal and particle linger unresolved",
      };
    },
    missile(observation) {
      const data = packet(observation, 28, 632),
        position = (offset, codec) => {
          const value = view(decoded(observation.object, offset, codec, 12));
          return [0, 4, 8].map((at) => value.getFloat32(at, true));
        },
        creationPosition = position(32, "missileCreationPosition"),
        replicationPosition = position(540, "missileRecordedPosition"),
        elapsedSeconds = view(
          decoded(observation.object, 552, "missileElapsedSeconds", 4),
        ).getFloat32(0, true),
        movementSpeed = view(
          decoded(observation.object, 84, "missileSpeed", 4),
        ).getFloat32(0, true),
        controllerScalarB0 = view(
          decoded(observation.object, 500, "missileControllerScalarB0", 4),
        ).getFloat32(0, true),
        controllerScalarB4 = view(
          decoded(observation.object, 44, "missileControllerScalarB4", 4),
        ).getFloat32(0, true);
      if (
        !creationPosition.every(Number.isFinite) ||
        !replicationPosition.every(Number.isFinite) ||
        !Number.isFinite(elapsedSeconds) ||
        !Number.isFinite(movementSpeed) ||
        !Number.isFinite(controllerScalarB0) ||
        !Number.isFinite(controllerScalarB4)
      )
        throw Error("Invalid missile position/elapsed candidate fields");
      const cast = castData(observation, 28, 632, 168);
      return {
        kind: "missile-replication-candidate",
        contextId: data.getUint32(12, true),
        entityId: cast.networkId,
        cast,
        creationPosition,
        replicationPosition,
        elapsedSeconds,
        movementSpeed,
        controllerScalarB0,
        controllerScalarB4,
        pendingChildren: decoded(
          observation.object,
          528,
          "missilePendingChildren",
          1,
        )[0],
        replicationPhase: decoded(
          observation.object,
          604,
          "missileReplicationPhase",
          1,
        )[0],
        initialPresentationByte: decoded(
          observation.object,
          156,
          "missileInitialPresentationByte",
          1,
        )[0],
        referenceVerified: false,
        stateStatus:
          "Native initializer registers the embedded network ID; replication XYZ applies only for positive elapsed time. Motion, effects, impacts and removal unresolved",
      };
    },
    death(observation) {
      const opcode = view(observation.object).getUint32(8, true);
      if (![514, 1018].includes(opcode))
        throw Error("Wrong death-family opcode");
      const data = packet(observation, opcode, 88),
        prefix = opcode === 1018 ? "heroDeath" : "death",
        killerId = view(
          decoded(observation.object, 20, `${prefix}KillerId`, 4),
        ).getUint32(0, true),
        respawnSeconds = view(
          decoded(observation.object, 68, `${prefix}RespawnSeconds`, 4),
        ).getFloat32(0, true);
      if (!data.getUint32(12, true) || !Number.isFinite(respawnSeconds))
        throw Error("Invalid death candidate fields");
      return {
        kind: "death-candidate",
        entityId: data.getUint32(12, true),
        killerId,
        respawnSeconds,
        referenceVerified: false,
        detailStatus:
          "Death-info flags, zombie/forms, corpse fade and removal unresolved",
      };
    },
    respawnTimer(observation) {
      const data = packet(observation, 201, 20),
        seconds = view(
          decoded(observation.object, 16, "respawnTimer", 4),
        ).getFloat32(0, true);
      if (!data.getUint32(12, true) || !Number.isFinite(seconds))
        throw Error("Invalid respawn timer fields");
      return {
        kind: "respawn-timer-candidate",
        entityId: data.getUint32(12, true),
        seconds,
        referenceVerified: false,
      };
    },
    respawn(observation) {
      const data = packet(observation, 683, 28),
        position = view(decoded(observation.object, 20, "respawnPosition", 8)),
        point = [0, 4].map((at) => position.getFloat32(at, true));
      if (!data.getUint32(12, true) || !point.every(Number.isFinite))
        throw Error("Invalid respawn position fields");
      return {
        kind: "respawn-candidate",
        entityId: data.getUint32(12, true),
        point,
        referenceVerified: false,
        scalar16Status: "Undecoded; no assumed health/resource value",
      };
    },
    laneMinionCreation(observation) {
      const data = packet(observation, 1084, 40),
        entityId = view(
          decoded(observation.object, 28, "laneSpawnNetworkId", 4),
        ).getUint32(0, true),
        unitType = decoded(observation.object, 32, "laneSpawnType", 1)[0],
        barracksId = (data.getUint32(20, true) ^ 0xf8f8f8f8) >>> 0;
      if (
        !entityId ||
        entityId !== data.getUint32(12, true) ||
        !barracksId ||
        unitType < 4 ||
        unitType > 7
      )
        throw Error("Unsupported or inconsistent lane-minion creation");
      return {
        kind: "lane-minion-creation-candidate",
        entityId,
        barracksId,
        unitType,
        modelBinding:
          "Requires matching map barracks configuration and identity",
        referenceVerified: false,
      };
    },
    npcCreation(observation) {
      const data = packet(observation, 849, 152),
        entityId = view(
          decoded(observation.object, 88, "npcNetworkId", 4),
        ).getUint32(0, true),
        position = view(
          decoded(observation.object, 100, "npcCreationPosition", 12),
        ),
        creationPosition = [0, 4, 8].map((at) => position.getFloat32(at, true));
      const text = (at, lengthAt) => {
        const length = data.getUint32(lengthAt, true);
        if (length < 1 || length > 256)
          throw Error("Invalid NPC identifier length");
        return new TextDecoder("utf-8", { fatal: true })
          .decode(vector(observation, data.getBigUint64(at, true), length))
          .replace(/\0$/, "");
      };
      const name = text(48, 56),
        character = text(128, 136),
        skinId = view(
          decoded(observation.object, 68, "npcSkinId", 4),
        ).getUint32(0, true);
      if (
        !entityId ||
        entityId !== data.getUint32(12, true) ||
        !creationPosition.every(Number.isFinite) ||
        !/^[A-Za-z0-9_]+$/.test(character)
      )
        throw Error("Invalid NPC creation fields");
      return {
        kind: "npc-creation-candidate",
        entityId,
        name,
        character,
        creationPosition,
        skinId,
        skinStatus:
          "Candidate skin argument passed to original AI-unit factory; asset/state validation required",
        referenceVerified: false,
      };
    },
    buildingIdentity(observation) {
      const data = packet(observation, 1005, 88),
        entityId = data.getUint32(12, true),
        length = data.getUint32(32, true);
      if (!entityId || length < 1 || length > 256)
        throw Error("Invalid building identity");
      const name = new TextDecoder("utf-8", { fatal: true })
          .decode(vector(observation, data.getBigUint64(24, true), length))
          .replace(/\0$/, ""),
        match = /^Turret_T(Order|Chaos)_L(\d+)_P(\d+)_(\d+)_(\d+)$/.exec(name);
      if (!match || Number(match[4]) > 0xffffffff)
        throw Error(`Unsupported static-building identity ${name}`);
      return {
        kind: "building-identity-candidate",
        entityId,
        name,
        team: match[1] === "Order" ? 100 : 200,
        mapNameHash: Number(match[4]),
        instance: Number(match[5]),
        referenceVerified: false,
      };
    },
    heroCreation(observation) {
      const data = packet(observation, 1049, 120),
        object = observation.object;
      const slot = decoded(object, 16, "heroSlot", 1)[0];
      const entityId = view(decoded(object, 56, "heroNetworkId", 4)).getUint32(
        0,
        true,
      );
      const position = view(decoded(object, 40, "heroCreationPosition", 12));
      const creationPosition = [0, 4, 8].map((offset) =>
        position.getFloat32(offset, true),
      );
      const skinId = view(decoded(object, 104, "heroScalar104", 4)).getUint32(
        0,
        true,
      );
      const length = data.getUint32(88, true);
      if (
        !entityId ||
        slot < 1 ||
        slot > 10 ||
        length < 1 ||
        length > 128 ||
        !creationPosition.every(Number.isFinite)
      )
        throw Error("Invalid hero-creation candidate fields");
      const champion = new TextDecoder("utf-8", { fatal: true }).decode(
        vector(observation, data.getBigUint64(80, true), length),
      );
      if (!/^[A-Za-z0-9_]+$/.test(champion))
        throw Error("Invalid decoded champion asset identifier");
      return {
        kind: "hero-creation-candidate",
        entityId,
        slot,
        champion,
        creationPosition,
        creationPositionIsCurrentSnapshotPosition: false,
        skinId,
        skinIdStatus: "candidate; asset validation required",
      };
    },
    movement(observation, deltaMode) {
      const opcode = view(observation.object).getUint32(8, true);
      if (![649, 657].includes(opcode))
        throw Error("Wrong movement-family opcode");
      const data = packet(observation, opcode, 40),
        length = data.getUint32(32, true),
        syncId = view(
          decoded(observation.object, 16, "movementSyncId", 4),
        ).getUint32(0, true),
        count = view(
          decoded(observation.object, 20, "movementCount", 2),
        ).getUint16(0, true);
      const records = length
        ? readMovementRecords(
            vector(observation, data.getBigUint64(24, true), length),
            { deltaMode, motionBlock: opcode === 649 },
          )
        : [];
      if (records.length !== count)
        throw Error(
          "Movement record count disagrees with native packet header",
        );
      return records.map((record) => ({ ...record, syncId, opcode }));
    },
    animation(observation) {
      const data = packet(observation, 1177, 64),
        object = observation.object;
      const length = data.getUint32(40, true),
        entityId = data.getUint32(12, true);
      if (!entityId || length < 1 || length > 1024)
        throw Error("Invalid animation-name candidate");
      const name = new TextDecoder("utf-8", { fatal: true }).decode(
        vector(observation, data.getBigUint64(32, true), length),
      );
      if (/[\u0000-\u001f]/.test(name))
        throw Error("Control byte in animation name");
      const scalar20 = view(
        decoded(object, 20, "animationScalar20", 4),
      ).getFloat32(0, true);
      const scalar52 = view(
        decoded(object, 52, "animationScalar52", 4),
      ).getFloat32(0, true);
      if (![scalar20, scalar52].every(Number.isFinite))
        throw Error("Non-finite animation scalar candidate");
      return {
        kind: "animation-candidate",
        entityId,
        name,
        scalar20,
        scalar52,
        scalarMeaningsVerified: false,
        unresolvedBytes: {
          16: object[16],
          24: object[24],
          25: object[25],
          48: object[48],
          49: object[49],
          50: object[50],
          56: [...object.subarray(56, 60)],
        },
      };
    },
    attack(observation) {
      const opcode = view(observation.object).getUint32(8, true),
        base = opcode === 209 ? 32 : opcode === 487 ? 24 : 16;
      const data = packet(
        observation,
        opcode,
        opcode === 209 ? 88 : opcode === 487 ? 80 : 72,
      );
      if (![209, 487, 495].includes(opcode))
        throw Error("Wrong attack family opcode");
      const uint = (at, name) =>
        view(decoded(observation.object, base + at, name, 4)).getUint32(
          0,
          true,
        );
      const position = view(
        decoded(observation.object, base + 20, "attackTargetPosition", 12),
      );
      const targetPosition = [0, 4, 8].map((at) =>
        position.getFloat32(at, true),
      );
      let sourcePosition =
        opcode === 487
          ? [data.getFloat32(16, true), data.getFloat32(20, true)]
          : null;
      if (opcode === 209) {
        // Native 0x116181 reads the first two float components, then passes
        // packet+0x20 to the same BasicAttackData handler at 0x114ae0.
        if (data.getUint32(24, true) !== 2)
          throw Error("Unsupported attack source-position vector length");
        const point = view(vector(observation, data.getBigUint64(16, true), 8));
        sourcePosition = [point.getFloat32(0, true), point.getFloat32(4, true)];
      }
      if (
        !targetPosition.every(Number.isFinite) ||
        (sourcePosition && !sourcePosition.every(Number.isFinite))
      )
        throw Error("Invalid attack position");
      return {
        kind: "attack-candidate",
        opcode,
        entityId: data.getUint32(12, true),
        castSequence: uint(8, "attackScalar8"),
        netId12: uint(12, "attackNetId12"),
        targetId: uint(48, "attackNetId48"),
        rawTiming: decoded(observation.object, base + 16, "attackByte16", 1)[0],
        attackSlot: decoded(
          observation.object,
          base + 17,
          "attackByte17",
          1,
        )[0],
        sourcePosition,
        targetPosition,
        embeddedCastCount: data.getUint32(base + 40, true),
        referenceVerified: false,
      };
    },
    cast(observation) {
      const data = packet(observation, 1027, 336);
      return {
        kind: "cast-candidate",
        entityId: data.getUint32(12, true),
        ...castData(observation, 1027, 336, 24),
        referenceVerified: false,
      };
    },
  };
}
