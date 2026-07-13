// Manual end-to-end assertion: does controller input actually change the game?
//
// Boots the real emulator twice in SEPARATE processes (the N64Wasm module is a
// process-global singleton, so two emulators can't coexist in one process):
//   1. baseline — no input, runs to frame `total`
//   2. start    — holds START from frame `warmup`, runs to frame `total`
// then asserts the two final frames differ. With the per-frame-reset bug, input
// is dropped and the two frames are byte-identical; with the fix, START advances
// the title screen to the GAME SELECT menu and they diverge.
//
// Requires a ROM (not in the repo) and a built wasm core (assets/n64wasm — run
// `bun run build:wasm` from the package root first).
//
// Usage: bun run scripts/e2e-input-assert.ts "<path-to-rom.z64>" [warmup] [total]
const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

const rom = process.argv.at(2);
const warmup = process.argv.at(3) ?? "950";
const total = process.argv.at(4) ?? "1200";
if (rom === undefined || rom === "") {
  throw new Error('usage: e2e-input-assert.ts "<rom.z64>" [warmup] [total]');
}

async function run(press: string, outPng: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      "scripts/e2e-input.ts",
      rom ?? "",
      press,
      warmup,
      total,
      outPng,
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`run press=${press} exited ${String(proc.exitCode)}`);
  }
  process.stdout.write(text);
  const m = /hash=([0-9a-f]+)/.exec(text);
  const hash = m?.[1];
  if (hash === undefined)
    throw new Error(`no frame hash in output for press=${press}`);
  return hash;
}

const baseline = await run("none", "/tmp/mk_assert_none.png");
const withStart = await run("start", "/tmp/mk_assert_start.png");

out(`\n[assert] baseline=${baseline} start=${withStart}`);
if (baseline === withStart) {
  console.error(
    "[assert] FAIL: holding START did not change the frame — input is NOT reaching the game.",
  );
  process.exit(1);
}
out(
  "[assert] PASS: START advanced the screen — controller input reaches the running game.",
);
process.exit(0);
