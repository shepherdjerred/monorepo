// Local-backend perf config writer for the browser-driven perf harness.
// Materialises a config.toml in a fresh tmp dir that wires the emulator +
// web server with stream/bot disabled (so we don't need a Discord token to
// run the harness). Returns the dir so the caller can spawn the backend
// inside it and clean it up on teardown.

import { tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";

export type PerfConfigInputs = {
  rom: string;
  wasmDir: string;
  assets: string;
  seats: number;
  backendPort: number;
};

export async function writePerfConfig(
  inputs: PerfConfigInputs,
): Promise<string> {
  const { rom, wasmDir, assets, seats, backendPort } = inputs;
  const raw =
    await $`mktemp -d ${path.join(tmpdir(), "mk64-perf-browser-XXXXXX")}`.text();
  const dir = raw.trim();
  const cfg = `
server_id = "0"

[bot]
enabled = false
discord_token = "x"
application_id = "0"

[bot.commands]
enabled = false
update = false

[bot.commands.screenshot]
enabled = false

[bot.notifications]
enabled = false
channel_id = "0"

[stream]
enabled = false
channel_id = "0"
dynamic_streaming = false
minimum_in_channel = 0
require_watching = false

[stream.userbot]
id = "0"
token = "x"

[stream.video]
frame_rate = 30
bitrate_kbps = 5000
bitrate_max_kbps = 8000
canvas_height = 720
hardware_acceleration = false

[emulator]
enabled = true
wasm_dir = ${JSON.stringify(wasmDir)}
rom_path = ${JSON.stringify(rom)}
fps = 30
software_render = true
seats = ${String(seats)}

[web]
enabled = true
cors = true
port = ${String(backendPort)}
assets = ${JSON.stringify(assets)}

[web.api]
enabled = true

[leaderboard]
enabled = false
db_path = ${JSON.stringify(path.join(dir, "lb.db"))}
overlay_enabled = false
poll_every_n_frames = 10
`;
  await Bun.write(path.join(dir, "config.toml"), cfg);
  return dir;
}
