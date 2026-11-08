import { openReplay, replayChunks, replayBlocks } from "./transport.mjs";
import { StructuralDecoder } from "./structural-decoder.mjs";
import { createLatestFieldReader } from "./latest-fields.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  createLatestCorpsePolicy,
  CORPSE_POLICY_SHA,
} from "./latest-corpse.mjs";
import { LATEST_REPLICATION_SHA } from "./latest-replication.mjs";
import {
  createLatestCombatStatReader,
  COMBAT_STATS_SHA,
} from "./latest-combat-stats.mjs";
import {
  createLatestInventoryReader,
  INVENTORY_SHA,
  INVENTORY_OPCODES,
} from "./latest-inventory.mjs";
import {
  createLatestExperienceReader,
  EXPERIENCE_SHA,
} from "./latest-experience.mjs";
import {
  createLatestWorldStateReader,
  WORLD_STATE_SHA,
} from "./latest-world-state.mjs";
import {
  createLatestChampionStateReader,
  CHAMPION_STATE_SHA,
} from "./latest-champion-state.mjs";
import {
  createLatestEffectRemovalReader,
  EFFECT_REMOVAL_PACKAGE_SHA,
} from "./latest-effect-removal.mjs";
import {
  createLatestEffectCreationReader,
  EFFECT_CREATION_PACKAGE_SHA,
} from "./latest-effect-creation.mjs";
import {
  createLatestEffectDescriptorReader,
  EFFECT_DESCRIPTOR_PACKAGE_SHA,
} from "./latest-effect-descriptor.mjs";
import { EFFECT_PLACEMENT_PACKAGE_SHA } from "./latest-effect-placement.mjs";
import { createLatestResourceRequestReader } from "./latest-resource-requests.mjs";
import {
  createLatestMissileTargetInputs,
  MISSILE_TARGET_INPUTS_SHA,
} from "./latest-missile-targets.mjs";
import { createLatestTargetVisibilityInputs } from "./latest-target-visibility.mjs";
import { createLatestTargetVisibilityMaskInputs } from "./latest-target-visibility-masks.mjs";
import { createLatestStartupConfig } from "./latest-startup-config.mjs";
import { readLatestReplayStartup } from "./latest-replay-startup.mjs";

// Browser-compatible research pipeline. It reports relative path records until
// their map origin is established; it never substitutes Summoner's Rift's origin.
export async function reconstructLatest({
  buffer,
  decompress,
  uc,
  profile,
  image,
  constructors,
  fieldCodecBytes,
  startupConfigBytes,
  effectRemovalBytes,
  effectCreationBytes,
  effectPlacementBytes,
  effectDescriptorBytes,
  appearanceStackInputBytes,
  unitFormInputBytes,
  missileTargetInputBytes,
  targetVisibilityInputBytes,
  targetVisibilityMaskInputBytes,
  replicationBytes,
  championStateBytes,
  combatStatBytes,
  experienceBytes,
  inventoryBytes,
  corpsePolicyBytes,
  worldStateBytes,
  worldSceneBytes,
  worldCatalogBytes,
  staticCatalog = null,
  endTime,
  deltaMode,
}) {
  const replay = openReplay(buffer);
  if (
    replay.roster.length !== 10 ||
    replay.roster.some((p) => ![100, 200].includes(p.team)) ||
    replay.roster.filter((p) => p.team === 100).length !== 5
  )
    throw Error("Expected a standard ten-player, five-per-team replay");
  if (
    replay.build !== profile.clientVersion ||
    replay.protocol !== profile.protocolDigest
  )
    throw Error("Replay does not match the exact decoder package");
  if (!Number.isFinite(endTime) || endTime < 0 || endTime > replay.duration)
    throw Error("Invalid reconstruction window");
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(constructors)) !== profile.constructorImageSha256 ||
    (await sha256(fieldCodecBytes)) !== profile.fieldCodecsSha256
  )
    throw Error("Decoder package integrity failure");
  const startupReader = await createLatestStartupConfig({
    profile,
    image,
    packageBytes: startupConfigBytes,
  });
  const startupDecoder = new StructuralDecoder(
    uc,
    profile,
    image,
    constructors,
  );
  let startup;
  try {
    startup = await readLatestReplayStartup({
      replay,
      decompress,
      decoder: startupDecoder,
      reader: startupReader,
      sceneBytes: worldSceneBytes,
    });
  } finally {
    startupDecoder.close();
  }
  const fields = createLatestFieldReader(
    profile,
    JSON.parse(new TextDecoder().decode(fieldCodecBytes)),
  );
  const effectRemovalReader = await createLatestEffectRemovalReader(
    profile,
    image,
    effectRemovalBytes,
  );
  const effectCreationReader = await createLatestEffectCreationReader(
    profile,
    image,
    effectCreationBytes,
  );
  const effectDescriptorReader = await createLatestEffectDescriptorReader({
    uc,
    profile,
    image,
    creationBytes: effectCreationBytes,
    placementBytes: effectPlacementBytes,
    descriptorBytes: effectDescriptorBytes,
    sceneBytes: worldSceneBytes,
    staticCatalog,
  });
  const replicationReader = await createLatestChampionStateReader(
    profile,
    image,
    replicationBytes,
    championStateBytes,
  );
  const worldStateReader = await createLatestWorldStateReader(
    profile,
    image,
    worldStateBytes,
    worldSceneBytes,
    worldCatalogBytes,
    staticCatalog,
  );
  const experienceReader = await createLatestExperienceReader(
    profile,
    image,
    experienceBytes,
    championStateBytes,
  );
  const inventoryReader = await createLatestInventoryReader(
    profile,
    image,
    inventoryBytes,
  );
  const combatStatReader = await createLatestCombatStatReader(
    profile,
    image,
    championStateBytes,
    combatStatBytes,
  );
  const resourceRequestReader = await createLatestResourceRequestReader({
    profile,
    image,
    appearancePackageBytes: appearanceStackInputBytes,
    formPackageBytes: unitFormInputBytes,
  });
  const missileTargetInputs = await createLatestMissileTargetInputs({
    profile,
    image,
    packageBytes: missileTargetInputBytes,
  });
  const targetVisibilityInputs = await createLatestTargetVisibilityInputs({
    profile,
    image,
    packageBytes: targetVisibilityInputBytes,
  });
  const targetVisibilityMaskInputs =
    await createLatestTargetVisibilityMaskInputs({
      profile,
      image,
      packageBytes: targetVisibilityMaskInputBytes,
    });
  const readCastTargets = (cast) => ({
    ...cast,
    requestedTargets: missileTargetInputs.read(
      cast.uninterpretedTargetEntries,
      cast.targetCount,
    ),
  });
  const decoder = new StructuralDecoder(uc, profile, image, constructors),
    heroes = new Map(),
    slots = new Map(),
    movement = [],
    animations = [],
    attacks = [],
    casts = [],
    lifecycle = [],
    missiles = [],
    missileEvents = [],
    worldEvents = [],
    effectRemovals = [],
    effectCreations = [],
    effectDescriptors = [],
    replicationRecords = [],
    resourceRequests = [],
    visibilityRequests = [];
  const corpsePolicy = await createLatestCorpsePolicy(
    profile,
    worldSceneBytes,
    worldCatalogBytes,
    corpsePolicyBytes,
    staticCatalog,
  );
  const inventoryEvents = [],
    corpseDeathStates = [];
  const unhandledOpcodes = {},
    decodedPackets = { 728: 1 };
  let sequence = 0,
    transportSequence = 0;
  try {
    for (const chunk of replayChunks(replay, decompress)) {
      if (![1, 2].includes(chunk.stream)) continue;
      for (const block of replayBlocks(chunk)) {
        const ordinal = transportSequence++;
        if (
          (block.opcode === 822 ||
            targetVisibilityMaskInputs.opcodes.includes(block.opcode)) &&
          block.time <= endTime
        ) {
          const reader =
            block.opcode === 822
              ? targetVisibilityInputs
              : targetVisibilityMaskInputs;
          const decoded = reader.read(
            decoder.observePacket(block.opcode, block.payload, block.param),
          );
          if (decoded.entityId !== block.param)
            throw Error(
              "Visibility request entity differs from original packet",
            );
          visibilityRequests.push({
            ...decoded,
            id: `visibility-request:${ordinal}:0`,
            origin: "network",
            opcode: block.opcode,
            time: block.time,
            transportSequence: ordinal,
            entryOrder: 0,
            stream: chunk.stream,
            chunkId: chunk.chunkId,
            blockOffset: block.blockOffset,
          });
          decodedPackets[block.opcode] =
            (decodedPackets[block.opcode] ?? 0) + 1;
          continue;
        }
        if (
          resourceRequestReader.opcodes.includes(block.opcode) &&
          block.time <= endTime
        ) {
          resourceRequests.push(
            resourceRequestReader.read(
              {
                ...block,
                stream: chunk.stream,
                chunkId: chunk.chunkId,
                transportSequence: ordinal,
              },
              decoder.observePacket(block.opcode, block.payload, block.param),
            ),
          );
          decodedPackets[block.opcode] =
            (decodedPackets[block.opcode] ?? 0) + 1;
          continue;
        }
        if (
          INVENTORY_OPCODES.includes(block.opcode) &&
          ((chunk.stream === 2 && block.time === 0) ||
            (chunk.stream === 1 && block.time <= endTime))
        ) {
          const observation = decoder.observePacket(
              block.opcode,
              block.payload,
              block.param,
            ),
            event = inventoryReader.read(observation);
          inventoryEvents.push({
            ...event,
            time: block.time,
            transportSequence: ordinal,
            chunkId: chunk.chunkId,
            blockOffset: block.blockOffset,
            stream: chunk.stream,
          });
          decodedPackets[block.opcode] =
            (decodedPackets[block.opcode] ?? 0) + 1;
          continue;
        }
        if (
          block.opcode === 26 &&
          ((chunk.stream === 2 && block.time === 0) ||
            (chunk.stream === 1 && block.time <= endTime))
        ) {
          const observation = decoder.observePacket(
            26,
            block.payload,
            block.param,
          );
          for (const record of replicationReader.read(observation))
            replicationRecords.push({
              ...record,
              time: block.time,
              transportSequence: ordinal,
              chunkId: chunk.chunkId,
              blockOffset: block.blockOffset,
              stream: chunk.stream,
            });
          decodedPackets[26] = (decodedPackets[26] ?? 0) + 1;
          continue;
        }
        if (
          block.opcode === 756 &&
          ((chunk.stream === 2 && block.time === 0) ||
            (chunk.stream === 1 && block.time <= endTime))
        ) {
          const observation = decoder.observePacket(
            block.opcode,
            block.payload,
            block.param,
          );
          const creations = effectCreationReader.read(observation),
            descriptors = effectDescriptorReader.read(observation);
          if (creations.length !== descriptors.length)
            throw Error("Effect creation/descriptor entry count differs");
          for (const [entryIndex, record] of creations.entries()) {
            const descriptor = descriptors[entryIndex],
              creationSequence = effectCreations.length;
            if (
              descriptor.entityId !== record.entityId ||
              descriptor.groupIndex !== record.groupIndex ||
              descriptor.entryIndex !== record.entryIndex
            )
              throw Error("Effect creation/descriptor identity differs");
            effectCreations.push({
              ...record,
              contextId: block.param,
              time: block.time,
              creationSequence: effectCreations.length,
              transportSequence: ordinal,
              chunkId: chunk.chunkId,
              blockOffset: block.blockOffset,
              stream: chunk.stream,
            });
            const { descriptorBytes, mutatedEntryBytes, ...fields } =
                descriptor,
              hex = (bytes) =>
                Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join(
                  "",
                );
            effectDescriptors.push({
              ...fields,
              creationSequence,
              time: block.time,
              transportSequence: ordinal,
              descriptorHex: hex(descriptorBytes),
              mutatedEntryHex: hex(mutatedEntryBytes),
            });
          }
          decodedPackets[756] = (decodedPackets[756] ?? 0) + 1;
          continue;
        }
        if (
          chunk.stream === 1 &&
          block.time <= endTime &&
          block.opcode === 187
        ) {
          const observation = decoder.observePacket(
            block.opcode,
            block.payload,
            block.param,
          );
          effectRemovals.push({
            ...effectRemovalReader.read(observation),
            time: block.time,
            removalSequence: effectRemovals.length,
            transportSequence: ordinal,
            chunkId: chunk.chunkId,
            blockOffset: block.blockOffset,
            stream: chunk.stream,
          });
          decodedPackets[187] = (decodedPackets[187] ?? 0) + 1;
          continue;
        }
        const initialHero =
          chunk.stream === 2 && block.time === 0 && block.opcode === 1049;
        const path =
          chunk.stream === 1 &&
          block.time <= endTime &&
          [649, 657].includes(block.opcode);
        const animation =
          chunk.stream === 1 && block.time <= endTime && block.opcode === 1177;
        const combat =
          chunk.stream === 1 &&
          block.time <= endTime &&
          [209, 487, 495, 1027].includes(block.opcode);
        const lifecycleState =
          chunk.stream === 1 &&
          block.time <= endTime &&
          [201, 514, 683, 1018].includes(block.opcode);
        const missileState =
          block.opcode === 28 &&
          ((chunk.stream === 2 && block.time === 0) ||
            (chunk.stream === 1 && block.time <= endTime));
        const missileEvent =
          chunk.stream === 1 &&
          block.time <= endTime &&
          [56, 99, 497].includes(block.opcode);
        const worldState =
          (chunk.stream === 2 &&
            block.time === 0 &&
            [849, 1005, 1084].includes(block.opcode)) ||
          (chunk.stream === 1 &&
            block.time <= endTime &&
            [849, 1084].includes(block.opcode));
        if (
          !initialHero &&
          !path &&
          !animation &&
          !combat &&
          !worldState &&
          !lifecycleState &&
          !missileState &&
          !missileEvent
        ) {
          if (chunk.stream === 1 && block.time <= endTime)
            unhandledOpcodes[block.opcode] =
              (unhandledOpcodes[block.opcode] ?? 0) + 1;
          continue;
        }
        const observation = decoder.observePacket(
          block.opcode,
          block.payload,
          block.param,
        );
        const provenance = {
          time: block.time,
          sequence: sequence++,
          transportSequence: ordinal,
          stream: chunk.stream,
          chunkId: chunk.chunkId,
          blockOffset: block.blockOffset,
        };
        decodedPackets[block.opcode] = (decodedPackets[block.opcode] ?? 0) + 1;
        if (initialHero) {
          const hero = fields.heroCreation(observation),
            metadata = replay.roster[hero.slot - 1];
          if (!metadata || hero.champion !== metadata.champion)
            throw Error(
              `Hero slot ${hero.slot} disagrees with replay metadata`,
            );
          if (heroes.has(hero.entityId) || slots.has(hero.slot))
            throw Error("Duplicate initial hero identity");
          heroes.set(hero.entityId, {
            ...hero,
            team: metadata.team,
            provenance,
          });
          slots.set(hero.slot, hero.entityId);
        } else if (missileEvent) {
          missileEvents.push({
            ...fields.missileEvent(observation),
            ...provenance,
          });
        } else if (missileState) {
          const missile = fields.missile(observation);
          missiles.push({
            ...missile,
            cast: readCastTargets(missile.cast),
            ...provenance,
            stream: chunk.stream,
            payloadSha256: await sha256(block.payload),
          });
        } else if (lifecycleState) {
          const event = [514, 1018].includes(block.opcode)
            ? fields.death(observation)
            : block.opcode === 201
              ? fields.respawnTimer(observation)
              : fields.respawn(observation);
          lifecycle.push({ ...event, ...provenance, opcode: block.opcode });
          if (block.opcode === 514)
            corpseDeathStates.push({
              ...corpsePolicy.readUnitDeath(observation),
              ...provenance,
              transportSequence: ordinal,
            });
        } else if (worldState) {
          const event =
            block.opcode === 1005
              ? fields.buildingIdentity(observation)
              : block.opcode === 849
                ? fields.npcCreation(observation)
                : fields.laneMinionCreation(observation);
          worldEvents.push({ ...event, ...provenance, stream: chunk.stream });
        } else if (combat) {
          if (block.opcode === 1027)
            casts.push({
              ...readCastTargets(fields.cast(observation)),
              ...provenance,
            });
          else attacks.push({ ...fields.attack(observation), ...provenance });
        } else if (animation) {
          animations.push({ ...fields.animation(observation), ...provenance });
        } else {
          for (const record of fields.movement(observation, deltaMode))
            movement.push({ ...record, ...provenance });
        }
      }
    }
  } finally {
    decoder.close();
    effectDescriptorReader.close();
  }
  if (heroes.size !== 10 || replay.roster.length !== 10)
    throw Error("Incomplete standard 5v5 startup identity set");
  const healthUpdates = [],
    championStateUpdates = [],
    experienceUpdates = [];
  for (const record of replicationRecords) {
    if (!heroes.has(record.entityId)) continue;
    const state = replicationReader.championState(record);
    const experience = experienceReader.experience(record);
    if (Object.hasOwn(experience.values, "experience"))
      experienceUpdates.push({
        entityId: record.entityId,
        ...experience.values,
        time: record.time,
        transportSequence: record.transportSequence,
        recordIndex: record.recordIndex,
        stateSequence: experienceUpdates.length,
        chunkId: record.chunkId,
        blockOffset: record.blockOffset,
        stream: record.stream,
      });
    if (Object.keys(state.values).length)
      championStateUpdates.push({
        entityId: record.entityId,
        ...state.values,
        time: record.time,
        transportSequence: record.transportSequence,
        recordIndex: record.recordIndex,
        stateSequence: championStateUpdates.length,
        chunkId: record.chunkId,
        blockOffset: record.blockOffset,
        stream: record.stream,
      });
    const health = replicationReader.championHealth(record);
    if (!health || !Object.keys(health.values).length) continue;
    healthUpdates.push({
      entityId: record.entityId,
      ...health.values,
      time: record.time,
      transportSequence: record.transportSequence,
      recordIndex: record.recordIndex,
      healthSequence: healthUpdates.length,
      chunkId: record.chunkId,
      blockOffset: record.blockOffset,
      stream: record.stream,
    });
  }
  movement.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  const orderedResourceRequests =
    resourceRequestReader.createTrack(resourceRequests).records;
  animations.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  for (const list of [
    attacks,
    casts,
    worldEvents,
    lifecycle,
    missiles,
    missileEvents,
  ])
    list.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  const report = {
    schema: 1,
    status: "semantic-candidate",
    build: replay.build,
    protocol: replay.protocol,
    startup,
    decoderImageSha256: profile.decoderImageSha256,
    constructorImageSha256: profile.constructorImageSha256,
    fieldCodecsSha256: profile.fieldCodecsSha256,
    effectRemovalPackageSha256: EFFECT_REMOVAL_PACKAGE_SHA,
    effectCreationPackageSha256: EFFECT_CREATION_PACKAGE_SHA,
    effectPlacementPackageSha256: await sha256(effectPlacementBytes),
    effectDescriptorPackageSha256: await sha256(effectDescriptorBytes),
    resourceRequestContract: resourceRequestReader.contract,
    replicationPackageSha256: LATEST_REPLICATION_SHA,
    championStatePackageSha256: CHAMPION_STATE_SHA,
    primaryResourceDefaults: replicationReader.metadata.primaryResourceDefaults,
    replaySha256: await sha256(buffer),
    duration: replay.duration,
    endTime,
    deltaMode,
    coordinateSpace: "signed16-relative-grid",
    coordinateUnit: 2,
    movementOrigin: null,
    referenceMovementVerified: false,
    heroes: [...heroes.values()].sort((a, b) => a.slot - b.slot),
    movement,
    animations,
    attacks,
    casts,
    worldEvents,
    lifecycle,
    missiles,
    missileEvents,
    effectRemovals,
    effectCreations,
    effectDescriptors,
    resourceRequests: orderedResourceRequests,
    visibilityRequests: visibilityRequests.sort(
      (a, b) => a.time - b.time || a.transportSequence - b.transportSequence,
    ),
    targetVisibilityInputContract: targetVisibilityInputs.contract,
    targetVisibilityMaskInputContract: targetVisibilityMaskInputs.contract,
    missileTargetInputContract: {
      packageSha256: MISSILE_TARGET_INPUTS_SHA,
      requestedNetworkIdsOnly: true,
      acceptedWorldTargets: false,
      trackingVerified: false,
    },
    resourceRequestScope: {
      snapshotGameplayStreamsSeparate: true,
      acceptedProducerMutations: false,
      resourceTracksSynthesized: false,
      unresolvedCopyProducerRequests: orderedResourceRequests
        .filter((event) => event.opcode === 965)
        .map((event) => event.id),
    },
    replicationRecords,
    healthUpdates,
    championStateUpdates,
    playerIdentities: [...heroes.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((h) => ({
        entityId: h.entityId,
        slot: h.slot,
        identity: replay.playerIdentities[h.slot - 1],
        source: "rofl-footer-slot",
      })),
    decodedPackets,
    unhandledOpcodes,
    summary: {
      heroes: heroes.size,
      replicationRecords: replicationRecords.length,
      championHealthUpdates: healthUpdates.length,
      championStateUpdates: championStateUpdates.length,
      effectRemovalRecords: effectRemovals.length,
      effectCreationRecords: effectCreations.length,
      effectDescriptorRecords: effectDescriptors.length,
      resourceRequestRecords: orderedResourceRequests.length,
      gameplayResourceRequests: orderedResourceRequests.filter(
        (event) => event.stream === 1,
      ).length,
      snapshotResourceRequests: orderedResourceRequests.filter(
        (event) => event.stream === 2,
      ).length,
      resourceRequestsByOpcode: Object.fromEntries(
        resourceRequestReader.opcodes.map((opcode) => [
          opcode,
          orderedResourceRequests.filter((event) => event.opcode === opcode)
            .length,
        ]),
      ),
      movementRecords: movement.length,
      heroMovementRecords: movement.filter((r) => heroes.has(r.entityId))
        .length,
      movingHeroes: new Set(
        movement.filter((r) => heroes.has(r.entityId)).map((r) => r.entityId),
      ).size,
      motionRecords: movement.filter((r) => r.motion !== null).length,
      heroMotionRecords: movement.filter(
        (r) => r.motion !== null && heroes.has(r.entityId),
      ).length,
      animationRecords: animations.length,
      heroAnimationRecords: animations.filter((a) => heroes.has(a.entityId))
        .length,
      animatedHeroes: new Set(
        animations.filter((a) => heroes.has(a.entityId)).map((a) => a.entityId),
      ).size,
      attackRecords: attacks.length,
      heroAttackRecords: attacks.filter((a) => heroes.has(a.entityId)).length,
      castRecords: casts.length,
      heroCastRecords: casts.filter((a) => heroes.has(a.entityId)).length,
      buildingIdentities: worldEvents.filter(
        (e) => e.kind === "building-identity-candidate",
      ).length,
      laneMinionCreations: worldEvents.filter(
        (e) => e.kind === "lane-minion-creation-candidate",
      ).length,
      npcCreations: worldEvents.filter(
        (e) => e.kind === "npc-creation-candidate",
      ).length,
      deaths: lifecycle.filter((e) => e.kind === "death-candidate").length,
      heroDeaths: lifecycle.filter(
        (e) => e.kind === "death-candidate" && heroes.has(e.entityId),
      ).length,
      heroRespawns: lifecycle.filter(
        (e) => e.kind === "respawn-candidate" && heroes.has(e.entityId),
      ).length,
      missileRecords: missiles.length,
      missileEventRecords: missileEvents.length,
      missilePhaseRecords: missileEvents.filter((e) => e.opcode === 56).length,
      missilePresentationRecords: missileEvents.filter((e) => e.opcode === 99)
        .length,
      missileStopRecords: missileEvents.filter((e) => e.opcode === 497).length,
      uniqueMissileNetworkIds: new Set(missiles.map((m) => m.entityId)).size,
      missileContextDisagreements: missiles.filter(
        (m) => m.contextId !== m.entityId,
      ).length,
      heroOwnedMissileRecords: missiles.filter((m) =>
        heroes.has(m.cast.ownerId),
      ).length,
    },
  };
  const worldState = worldStateReader.reconstruct(report);
  report.worldStatePackageSha256 = await sha256(worldStateBytes);
  report.experiencePackageSha256 = EXPERIENCE_SHA;
  report.experienceUpdates = experienceUpdates;
  report.combatStatPackageSha256 = COMBAT_STATS_SHA;
  report.combatStatUpdates = combatStatReader.reconstruct(
    replicationRecords,
    [...heroes.keys()],
    endTime,
  );
  report.summary.combatStatUpdates = report.combatStatUpdates.length;
  if (inventoryEvents.some((e) => !heroes.has(e.entityId)))
    throw Error("Inventory context is not an admitted champion");
  report.inventoryPackageSha256 = INVENTORY_SHA;
  report.inventoryEvents = inventoryEvents;
  report.corpsePolicyPackageSha256 = corpsePolicy.packageSha256;
  report.corpseDeathStates = corpseDeathStates;
  report.summary.unitDeathModeRecords = corpseDeathStates.length;
  report.summary.inventoryEvents = inventoryEvents.length;
  report.summary.experienceUpdates = experienceUpdates.length;
  report.worldEntities = worldState.entities;
  report.worldStateUpdates = worldState.updates;
  report.summary.worldStateEntities = worldState.entities.length;
  report.summary.worldStateUpdates = worldState.updates.length;
  return report;
}
