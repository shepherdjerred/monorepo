import { Emulator } from "./emulator.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import { readGameSaveDetails } from "#src/game/game-save-details.ts";
import { BUTTON } from "./constants.ts";

// Boots the real pokeemerald.wasm and asserts the game-state symbols still
// resolve and a snapshot read doesn't throw. It's the canary for renamed/moved
// symbols before they reach production. The wasm is no longer committed — it's
// built from source in the Docker image build (and locally by
// scripts/build-wasm.ts), where this gate runs against the real artifact. When
// the wasm is absent (plain `bun run test` on a clean checkout), skip.
//
// The checkpoint/reboot test deterministically creates a new game when no
// operator save is supplied. This keeps the Docker ABI stage self-contained
// while still exercising the real title screen, save code, and reboot path.
// Operators can override the source save for additional manual coverage.

const WASM_PATH =
  Bun.env.POKEMON_WASM_PATH ??
  new URL("../../assets/pokeemerald.wasm", import.meta.url).pathname;
const CHECKPOINT_SOURCE_SAVE_PATH = Bun.env.POKEMON_LIVE_SAVE_PATH;
const FLASH_SAVE_BYTES = 128 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reachPlayableOverworld(
  emulator: Emulator,
): Promise<ReturnType<Emulator["engineObservation"]>> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const observation = emulator.engineObservation();
    if (observation.world !== null && observation.readiness.inputReady) {
      return observation;
    }
    if (Date.now() >= deadline) {
      throw new Error("game did not reach a playable overworld");
    }
    // A fresh game accepts the default menu, gender, and player-name choices
    // with A. One released frame preserves distinct key-down edges while
    // minimizing the real-time cost of deterministic prerequisite generation.
    await emulator.queuePress(BUTTON.a, 1, 1);
  }
}

function passableMovementButton(
  observation: ReturnType<Emulator["engineObservation"]>,
): number {
  const world = observation.world;
  if (world === null) throw new Error("world is unavailable for movement");
  if (world.collision.north.passable) return BUTTON.up;
  if (world.collision.south.passable) return BUTTON.down;
  if (world.collision.west.passable) return BUTTON.left;
  if (world.collision.east.passable) return BUTTON.right;
  throw new Error("loaded save has no passable adjacent tile");
}

// `Bun.file().size` is synchronous and returns 0 for a missing file — used here
// instead of node:fs (banned by the bun-runtime lint rule).
const describeWasm = Bun.file(WASM_PATH).size > 0 ? describe : describe.skip;

describeWasm("emulator game symbols (real wasm)", () => {
  test("resolves all symbols and reads snapshots without throwing", async () => {
    const emulator = new Emulator({ wasmPath: WASM_PATH });
    await emulator.init();

    const symbols = emulator.gameSymbols();
    // Every symbol must resolve to a plausible linear-memory address.
    for (const [name, address] of Object.entries(symbols)) {
      expect(address, name).toBeGreaterThan(0x10_00);
      expect(address, name).toBeLessThan(0x10_00_00_00);
    }

    const reader = emulator.memoryReader();
    // Fresh boot: no save loaded yet, so these are expected to be null — the
    // contract is "doesn't throw", which is what the watcher relies on.
    expect(() => readGameSnapshot(reader, symbols)).not.toThrow();
    expect(() => readSpatialSnapshot(reader, symbols)).not.toThrow();
    const bootObservation = emulator.engineObservation();
    expect(bootObservation.version).toBe(5);
    expect(bootObservation.size).toBe(144);
    expect(() => emulator.engineMapTile(0, 0)).not.toThrow();
    expect(emulator.engineMapTopology()).toBeNull();
    expect(emulator.engineCanUseBattleItemOnPartyMon(13, 1)).toBe(false);
    expect(emulator.engineCanUseBattleItemOnBattler(75, 0)).toBe(false);
    expect(emulator.engineCanRunFromBattle(0)).toBe(false);

    // Run a few hundred frames and confirm reads stay safe as the game runs.
    emulator.start();
    const target = emulator.frame + 200;
    const deadline = Date.now() + 15_000;
    while (emulator.frame < target && Date.now() < deadline) {
      await sleep(50);
    }
    emulator.stop();

    expect(emulator.frame).toBeGreaterThan(target - 1);
    expect(() => readGameSnapshot(reader, symbols)).not.toThrow();
    expect(() => readSpatialSnapshot(reader, symbols)).not.toThrow();
    expect(emulator.engineObservation().frame).toBeGreaterThan(
      bootObservation.frame,
    );
  }, 30_000);

  test("checkpoints deterministic state that survives an independent reboot", async () => {
    const sourceSave =
      CHECKPOINT_SOURCE_SAVE_PATH === undefined
        ? new Uint8Array(FLASH_SAVE_BYTES).fill(0xff)
        : await Bun.file(CHECKPOINT_SOURCE_SAVE_PATH).bytes();
    const checkpointPath = `${Bun.env.TMPDIR ?? "/tmp"}/pokemon-checkpoint-${crypto.randomUUID()}.sav`;
    await Bun.write(checkpointPath, sourceSave);
    try {
      const emulator = new Emulator({
        wasmPath: WASM_PATH,
        savePath: checkpointPath,
      });
      await emulator.init();
      emulator.start();
      let observation: ReturnType<Emulator["engineObservation"]>;
      try {
        observation = await reachPlayableOverworld(emulator);
        const startingWorld = observation.world;
        if (startingWorld === null) {
          throw new Error("loaded save has no world before movement");
        }
        const topology = emulator.engineMapTopology();
        if (topology === null) {
          throw new Error("loaded save has no map topology");
        }
        expect(topology.mapGroup).toBe(startingWorld.mapGroup);
        expect(topology.mapNum).toBe(startingWorld.mapNum);
        expect(topology.width).toBeGreaterThan(0);
        expect(topology.height).toBeGreaterThan(0);
        expect(topology.bounds).toEqual({
          minX: 7,
          maxX: topology.width + 6,
          minY: 7,
          maxY: topology.height + 6,
        });
        expect(
          topology.connections.map((connection) => connection.index),
        ).toEqual(
          Array.from(
            { length: topology.connections.length },
            (_, index) => index,
          ),
        );
        expect(topology.warps.map((warp) => warp.index)).toEqual(
          Array.from({ length: topology.warps.length }, (_, index) => index),
        );
        expect(
          topology.connections.length + topology.warps.length,
        ).toBeGreaterThan(0);
        for (const warp of topology.warps) {
          expect(warp.trigger.x).toBeGreaterThanOrEqual(topology.bounds.minX);
          expect(warp.trigger.x).toBeLessThanOrEqual(topology.bounds.maxX);
          expect(warp.trigger.y).toBeGreaterThanOrEqual(topology.bounds.minY);
          expect(warp.trigger.y).toBeLessThanOrEqual(topology.bounds.maxY);
          expect(
            emulator.engineMapTile(warp.trigger.x, warp.trigger.y),
          ).not.toBeNull();
        }
        const startingPosition = `${String(startingWorld.mapGroup)}:${String(startingWorld.mapNum)}:${String(startingWorld.x)}:${String(startingWorld.y)}`;
        const movementButton = passableMovementButton(observation);
        let movedPosition = startingPosition;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await emulator.queuePress(movementButton, 3, 60);
          observation = emulator.engineObservation();
          const world = observation.world;
          if (world === null) {
            throw new Error("world became unavailable during checkpoint move");
          }
          movedPosition = `${String(world.mapGroup)}:${String(world.mapNum)}:${String(world.x)}:${String(world.y)}`;
          if (movedPosition !== startingPosition) break;
        }
        expect(movedPosition).not.toBe(startingPosition);
        await emulator.checkpointSave();
      } finally {
        await emulator.stopAndFlush();
      }

      expect(observation.world).not.toBeNull();
      const liveSnapshot = readGameSnapshot(
        emulator.memoryReader(),
        emulator.gameSymbols(),
      );
      if (liveSnapshot === null) {
        throw new Error("live snapshot was unavailable after checkpoint");
      }
      const outputSave = await Bun.file(checkpointPath).bytes();
      expect(outputSave).toHaveLength(128 * 1024);
      expect(outputSave).not.toEqual(sourceSave);

      const verifier = new Emulator({
        wasmPath: WASM_PATH,
        savePath: checkpointPath,
      });
      await verifier.init();
      verifier.start();
      let persistedObservation: ReturnType<Emulator["engineObservation"]>;
      try {
        persistedObservation = await reachPlayableOverworld(verifier);
      } finally {
        await verifier.stopAndFlush();
      }
      const persistedSnapshot = readGameSnapshot(
        verifier.memoryReader(),
        verifier.gameSymbols(),
      );
      if (persistedSnapshot === null) {
        throw new Error("persisted snapshot was unavailable after reboot");
      }
      expect(persistedObservation.world).toMatchObject({
        mapGroup: observation.world?.mapGroup,
        mapNum: observation.world?.mapNum,
        x: observation.world?.x,
        y: observation.world?.y,
        facing: observation.world?.facing,
      });
      expect(persistedSnapshot.party).toEqual(liveSnapshot.party);
      expect(persistedSnapshot.dexOwned).toEqual(liveSnapshot.dexOwned);

      const liveDetails = readGameSaveDetails(
        emulator.memoryReader(),
        emulator.gameSymbols(),
      );
      if (liveDetails === null) {
        throw new Error("live save details were unavailable");
      }
      const persistedDetails = readGameSaveDetails(
        verifier.memoryReader(),
        verifier.gameSymbols(),
      );
      if (persistedDetails === null) {
        throw new Error("persisted save details were unavailable after reboot");
      }
      expect(persistedDetails).toEqual(liveDetails);
    } finally {
      await Bun.file(checkpointPath).delete();
    }
  }, 180_000);
});
