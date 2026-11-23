import { createHash } from "node:crypto";
import { createChampionReturnObserver } from "../replay-champion-lifecycle.mjs";
import { verifyReplayParticipantBindings } from "../replay-participant-bindings.mjs";
import { openReplay } from "../transport.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { auditChampionAnimation } from "./verify-native-terrain-champion-animation.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const soundEventClass = mapBinHash("SoundEventData");
const soundNameField = "9d477e74";

const [replayPath, manifestPath, installation, ...extra] =
  process.argv.slice(2);
if (!replayPath || !manifestPath || !installation || extra.length)
  throw Error(
    "Usage: bun verify-native-terrain-champion-deaths.mjs <original ROFL> <private champion manifest> <exact Windows installation>",
  );

const bytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(bytes);
const assets = await auditChampionAnimation(
  installation,
  manifestPath,
  replay.bytes,
  ["Death"],
  { includeEvents: true },
);
if (replay.build !== assets.build || replay.protocol !== assets.protocol)
  throw Error("Replay build or protocol disagrees with the asset manifest");

const actors = new Map(assets.actors.map((actor) => [actor.context, actor]));
if (new Set(assets.actors.map(({ footerRow }) => footerRow)).size !== 10)
  throw Error("Expected ten distinct champion footer rows");

const creationDigests = new Set();
const witnesses = new Map();
const returnObserver = createChampionReturnObserver(replay);
let openingChunk;
const combat = verifyReplayParticipantBindings(replay, Bun.zstdDecompressSync, {
  observeRawPacket({ stream, chunkOffset, explicitOpcode, payload }) {
    if (stream !== 2) return;
    openingChunk ??= chunkOffset;
    if (chunkOffset === openingChunk && explicitOpcode === 88)
      creationDigests.add(hash(payload));
  },
  observeGameplayPacket(packet, opcode, context) {
    returnObserver.observeGameplayPacket(packet, opcode, context);
    if (!actors.has(context)) return;
    const { payload, secondTimeBits, timeSeconds, chunkOffset, blockOffset } =
      packet;
    if (opcode !== 1183 && !(opcode === 172 && payload.length === 116)) return;
    const key = `${context}/${secondTimeBits}`;
    const packets = witnesses.get(key) ?? [];
    packets.push({
      opcode,
      timeSeconds,
      chunkOffset,
      blockOffset,
      payloadBytes: payload.length,
    });
    witnesses.set(key, packets);
  },
});

const verifiedRows = new Map(
  combat.verified.map(({ context, footerRow }) => [context, footerRow]),
);
for (const {
  context,
  champion,
  footerRow,
  creationSha256,
} of actors.values()) {
  const verifiedRow = verifiedRows.get(context);
  if (
    !Number.isSafeInteger(context) ||
    !Number.isSafeInteger(footerRow) ||
    !creationDigests.delete(creationSha256) ||
    replay.roster[footerRow - 1]?.champion !== champion ||
    (verifiedRow !== undefined && verifiedRow !== footerRow) ||
    (verifiedRow === undefined && !combat.unresolved.includes(context))
  )
    throw Error(
      "Champion asset manifest disagrees with opening replay evidence",
    );
}
if (creationDigests.size)
  throw Error("Champion manifest omitted an opening hero creation");

const returns = returnObserver.finish(combat);
const deaths = combat.events
  .filter(({ kind }) => kind === "champion-death")
  .map(({ context, timeSeconds, secondTimeBits }) => {
    const actor = actors.get(context);
    const key = `${context}/${secondTimeBits}`;
    const packets = witnesses.get(key);
    if (
      !actor ||
      packets?.length !== 2 ||
      !packets.some((p) => p.opcode === 172 && p.timeSeconds === timeSeconds) ||
      !packets.some((p) => p.opcode === 1183)
    )
      throw Error("Champion death lacks an exact two-packet witness");
    witnesses.delete(key);
    const clip = actor.probes.Death;
    if (!clip) throw Error("Selected skin has no authored Death graph entry");
    const soundEvents = (clip.events ?? [])
      .filter(({ value }) => value.classHash === soundEventClass)
      .map(({ value }) => {
        const name = value.fields[soundNameField];
        if (name?.type !== "String" || !name.value)
          throw Error("Authored death sound has no event name");
        return name.value;
      });
    return {
      context,
      champion: actor.champion,
      skinId: actor.skinId,
      timeSeconds,
      secondTimeBits,
      packets,
      animationGraph: actor.animationGraph,
      deathGraphClass: clip.classHash,
      authoredClip: clip.sha256
        ? {
            resource: clip.resource,
            sha256: clip.sha256,
            version: clip.version,
          }
        : null,
      authoredSoundEvents: soundEvents,
    };
  });
if (witnesses.size) throw Error("Unpaired champion death witness");

console.log(
  JSON.stringify(
    {
      schema: 1,
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: assets.replaySha256,
      championManifestSha256: assets.championManifestSha256,
      executableSha256: assets.executableSha256,
      duration: replay.duration,
      championContexts: actors.size,
      verifiedDeaths: deaths.length,
      verifiedReturns: returns.length,
      directAuthoredClips: deaths.filter(({ authoredClip }) => authoredClip)
        .length,
      authoredSoundCues: deaths.filter(
        ({ authoredSoundEvents }) => authoredSoundEvents.length,
      ).length,
      unverified: [
        "native animation dispatch",
        "clip phase and variant",
        "sound timing and media",
        "rendered playback",
      ],
      deaths,
    },
    null,
    2,
  ),
);
