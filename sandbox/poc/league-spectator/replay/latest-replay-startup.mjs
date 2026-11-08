import { replayChunks, replayBlocks } from "./transport.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { STARTUP_CONFIG_SHA } from "./latest-startup-config.mjs";

export function assertLatestStartupSceneMap(startup, sceneBytes) {
  if (!(sceneBytes instanceof Uint8Array))
    throw Error("Scene bytes required for startup map validation");
  const scene = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(sceneBytes),
  );
  if (
    !Number.isInteger(scene?.map?.id) ||
    scene.map.id <= 0 ||
    !Number.isInteger(startup?.configuredMapId) ||
    startup.configuredMapId <= 0
  )
    throw Error("Explicit recorded and scene map identities required");
  if (scene.map.id !== startup.configuredMapId)
    throw Error(
      `Recorded map ${startup.configuredMapId} differs from selected scene map ${scene.map.id}`,
    );
}

// Startup has its own stream-local provenance. It never consumes the existing
// stream1/2 transport ordinals used by world and combat event identities.
export async function readLatestReplayStartup({
  replay,
  decompress,
  decoder,
  reader,
  sceneBytes,
}) {
  let startup = null,
    streamSequence = 0;
  for (const chunk of replayChunks(replay, decompress, { streams: [3] })) {
    for (const block of replayBlocks(chunk)) {
      const ordinal = streamSequence++;
      if (block.opcode !== 728) continue;
      if (startup)
        throw Error(
          "Exactly one recorded startup configuration required: duplicate 728",
        );
      if (block.time !== 0 || block.param !== 0)
        throw Error("Unexpected startup configuration identity");
      const observation = decoder.observePacket(
        block.opcode,
        block.payload,
        block.param,
      );
      if (!observation.complete)
        throw Error(
          "Original startup decoder did not consume the complete packet",
        );
      startup = {
        ...reader.read(observation),
        packageSha256: STARTUP_CONFIG_SHA,
        source: {
          id: `startup:${chunk.chunkId}:${block.blockOffset}:728`,
          opcode: 728,
          time: block.time,
          param: block.param,
          stream: 3,
          chunkId: chunk.chunkId,
          blockOffset: block.blockOffset,
          streamSequence: ordinal,
          payloadSha256: await sha256(block.payload),
        },
      };
    }
  }
  if (!startup)
    throw Error(
      "Exactly one recorded startup configuration required: missing 728",
    );
  if (sceneBytes !== undefined)
    assertLatestStartupSceneMap(startup, sceneBytes);
  return startup;
}
