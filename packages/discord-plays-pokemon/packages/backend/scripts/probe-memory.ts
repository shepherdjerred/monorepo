// Phase-0 validation harness for the game-event memory watcher.
//
// Boots the real pokeemerald.wasm with the real Emulator class and exposes a
// tiny local HTTP interface so a human (or agent) can drive the game and
// inspect parsed game state side by side:
//
//   bun scripts/probe-memory.ts [--save <path>] [--port <port>]
//
//   GET  /probe                          parsed snapshot + raw pointers
//   GET  /screenshot                     current frame as PNG (2x)
//   POST /press/<button>?hold=&gap=&times=   queue button presses
//   GET  /frame                          current frame counter
//
// Buttons: a b start select up down left right l r

import { Emulator } from "#src/emulator/emulator.ts";
import { BUTTON } from "#src/emulator/constants.ts";
import { encodePng } from "#src/emulator/png.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { logger } from "#src/logger.ts";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const wasmPath = new URL("../assets/pokeemerald.wasm", import.meta.url)
  .pathname;
const savePath = argValue("--save") ?? "/tmp/pokemon-probe/probe.flash";
const port = Number(argValue("--port") ?? "7777");

const emulator = new Emulator({ wasmPath, savePath });
await emulator.init();
emulator.start();

const reader = emulator.memoryReader();
const symbols = emulator.gameSymbols();
logger.info(`game symbols: ${JSON.stringify(symbols)}`);

// Name -> bitmask without a type guard (banned) or assertion.
const BUTTON_BY_NAME = new Map<string, number>(Object.entries(BUTTON));

function probe(): Record<string, unknown> {
  const sb1 = reader.u32(symbols.gSaveBlock1Ptr);
  const sb2 = reader.u32(symbols.gSaveBlock2Ptr);
  const snapshot = readGameSnapshot(reader, symbols);
  // SaveBlock1 offset 0 is `struct Coords16 pos` (s16 x, s16 y) — handy for
  // navigating the probe deterministically.
  const validSb1 = sb1 >= 0x10_00 && sb1 + 4 <= reader.byteLength;
  const pos = validSb1
    ? { x: (reader.u16(sb1) << 16) >> 16, y: (reader.u16(sb1 + 2) << 16) >> 16 }
    : null;
  return {
    frame: emulator.frame,
    pos,
    symbols: Object.fromEntries(
      Object.entries(symbols).map(([k, v]) => [k, `0x${v.toString(16)}`]),
    ),
    saveBlock1Ptr: `0x${sb1.toString(16)}`,
    saveBlock2Ptr: `0x${sb2.toString(16)}`,
    partyCountRaw: reader.u8(symbols.gPlayerPartyCount),
    snapshot:
      snapshot === null
        ? null
        : {
            party: snapshot.party,
            badges: snapshot.badges,
            dexOwnedBitCount: [...snapshot.dexOwned].reduce((acc, byte) => {
              let bits = 0;
              for (let b = byte; b > 0; b >>= 1) bits += b & 1;
              return acc + bits;
            }, 0),
            caughtMonSpecies: snapshot.caughtMonSpecies,
            caughtMonShiny: snapshot.caughtMonShiny,
          },
  };
}

Bun.serve({
  port,
  idleTimeout: 60,
  fetch(request: Request): Response {
    const url = new URL(request.url);
    const parts = url.pathname.split("/");
    const route = parts.at(1);
    const arg = parts.at(2);

    if (route === "probe") {
      return Response.json(probe());
    }
    if (route === "frame") {
      return Response.json({ frame: emulator.frame });
    }
    if (route === "screenshot") {
      const png = encodePng(emulator.renderFrame(), 2);
      return new Response(new Uint8Array(png), {
        headers: { "content-type": "image/png" },
      });
    }
    if (route === "press" && request.method === "POST" && arg !== undefined) {
      const name = arg.toLowerCase();
      const mask = BUTTON_BY_NAME.get(name);
      if (mask === undefined) {
        return new Response(`unknown button: ${name}`, { status: 400 });
      }
      const hold = Number(url.searchParams.get("hold") ?? "8");
      const gap = Number(url.searchParams.get("gap") ?? "8");
      const times = Number(url.searchParams.get("times") ?? "1");
      for (let i = 0; i < times; i++) {
        void emulator.queuePress(mask, hold, gap);
      }
      return Response.json({ pressed: name, hold, gap, times });
    }
    return new Response("not found", { status: 404 });
  },
});

logger.info(`probe listening on http://localhost:${String(port)}`);
