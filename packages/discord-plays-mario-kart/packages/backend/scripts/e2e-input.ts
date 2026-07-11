// Local e2e: prove web-controller input actually reaches the running game.
//
// Boots the real N64Emulator (same code path the server uses: setPlayerInput ->
// tick -> encodeButtons -> neil_send_mobile_controls_player -> applyHostControls
// -> retro_run), steps a fixed, deterministic number of frames, optionally holds
// a button after a warmup, and writes a PNG + a frame hash of the final frame.
//
// Determinism: emulation advances exactly one frame per tick regardless of the
// fps pacing, and input is keyed off the frame counter, so two runs with the
// same (rom, config, input schedule) produce byte-identical frames.
//
// Usage:
//   bun run scripts/e2e-input.ts [rom] <press> <warmup> <total> <outPng>
//     press : none | start | a | accel | left | right
//   (rom resolves via --rom-less default: arg → MK64_ROM → Syncthing path)
//
// Not a CI test (needs a ROM, which is not in the repo). Run locally.
import { createHash } from "node:crypto";
import { bootEmulator, resolveRom } from "./lib/harness.ts";
import { encodePng } from "#src/emulator/png.ts";
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";
import type { PlayerInputState } from "@discord-plays-mario-kart/common";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

const press = process.argv.at(3) ?? "none";
const warmup = Number(process.argv.at(4) ?? 600);
const total = Number(process.argv.at(5) ?? 1200);
const outPng = process.argv.at(6) ?? `/tmp/mk_${press}.png`;
const rom = await resolveRom(process.argv.at(2));

function inputFor(kind: string): PlayerInputState {
  const buttons = { ...EMPTY_BUTTONS };
  let analogX = 0;
  const analogY = 0;
  switch (kind) {
    case "start":
      buttons.start = true;
      break;
    case "a":
    case "accel":
      buttons.a = true;
      break;
    case "left":
      analogX = -1;
      break;
    case "right":
      analogX = 1;
      break;
    case "none":
      break;
    default:
      throw new Error(`unknown press: ${kind}`);
  }
  return { buttons, analogX, analogY };
}

const held = inputFor(press);

out(`[e2e] booting (rom=${rom})…`);
const emu = await bootEmulator({ rom, seats: 4 });

const dumpEvery = Number(Bun.env["DUMP_EVERY"] ?? 0);
function meanLuma(rgba: Buffer, w: number, h: number): number {
  let sum = 0;
  for (let i = 0; i < w * h; i++)
    sum += (rgba[i * 4] ?? 0) + (rgba[i * 4 + 1] ?? 0) + (rgba[i * 4 + 2] ?? 0);
  return sum / (w * h * 3);
}

let frame = 0;
let applied = false;
await new Promise<void>((resolve) => {
  emu.onFrame(() => {
    frame++;
    if (frame === warmup && press !== "none") {
      emu.setPlayerInput(0, held); // P1 holds `press` from here on
      applied = true;
    }
    if (dumpEvery > 0 && frame % dumpEvery === 0) {
      const f = emu.renderFrame();
      const luma = meanLuma(f.rgba, f.width, f.height).toFixed(1);
      void Bun.write(
        outPng.replace(/\.png$/, `_${String(frame).padStart(5, "0")}.png`),
        encodePng(f.rgba, f.width, f.height, 2),
      );
      out(`[e2e]   frame ${String(frame)} luma=${luma}`);
    }
    if (frame >= total) {
      emu.stop();
      resolve();
    }
  });
  emu.start();
});

const { rgba, width, height } = emu.renderFrame();
const png = encodePng(rgba, width, height, 2);
await Bun.write(outPng, png);

// Hash only the RGB (drop the dead alpha byte) of the final frame.
const rgb = Buffer.alloc(width * height * 3);
for (let i = 0, j = 0; i < width * height; i++) {
  rgb[j++] = rgba[i * 4] ?? 0;
  rgb[j++] = rgba[i * 4 + 1] ?? 0;
  rgb[j++] = rgba[i * 4 + 2] ?? 0;
}
const hash = createHash("sha256").update(rgb).digest("hex").slice(0, 16);

out(
  `[e2e] press=${press} warmup=${String(warmup)} total=${String(total)} ` +
    `applied=${String(applied)} frame=${String(frame)} ` +
    `size=${String(width)}x${String(height)} hash=${hash} -> ${outPng}`,
);
process.exit(0);
