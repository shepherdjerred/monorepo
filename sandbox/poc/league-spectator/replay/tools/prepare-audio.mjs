import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { openWad } from "./wad.mjs";
const research = resolve(process.argv[2]),
  cache = resolve(process.argv[3] ?? ".cache/replay-spike"),
  python = process.argv[4] ?? "python";
const { parseRman } = await import(
  pathToFileURL(`${research}/lol-exe-downloader/src/rman.js`)
);
const { decompress } = await import(
  pathToFileURL(
    `${research}/lol-exe-downloader/node_modules/fzstd/esm/index.mjs`,
  )
);
const manifestBytes = new Uint8Array(
  await Bun.file(`${cache}/client.manifest`).arrayBuffer(),
);
if (
  new Bun.CryptoHasher("sha256").update(manifestBytes).digest("hex") !==
  "5b3441fb36ba7ed35db43682507db5a8126a2c35bc35d1f4c568dc9c60a836ea"
)
  throw Error("Manifest mismatch");
const manifest = parseRman(manifestBytes);
// Static SFX banks only. Event selection happens from browser-decoded casts.
const lineup = await Bun.file(
  `${dirname(fileURLToPath(import.meta.url))}/lineup.json`,
).json();
for (const champion of Object.keys(lineup)) {
  const wad = await openWad(
    manifest,
    `DATA/FINAL/Champions/${champion}.wad.client`,
    cache,
    decompress,
  );
  const skin = await Bun.file(
    `${cache}/public/champions/${champion}/skin.json`,
  ).json();
  const root = Object.values(skin).find((v) => v?.skinAudioProperties);
  const banks = root.skinAudioProperties.bankUnits.filter((b) => !b.voiceOver);
  const folder = `${cache}/audio/${champion}`,
    events = [];
  for (const bank of banks) {
    events.push(...bank.events);
    for (const path of bank.bankPath) {
      const file = `${folder}/${path.split("/").at(-1)}`;
      if (!(await Bun.file(file).exists()))
        await Bun.write(file, await wad(path.toLowerCase()));
    }
  }
  await Bun.write(`${folder}/wwnames.txt`, events.join("\n"));
  await Bun.write(`${folder}/events.json`, JSON.stringify(events));
  console.log(`Prepared ${champion} SFX banks`);
}

const revision = Bun.spawnSync([
  "git",
  "-C",
  `${research}/wwiser`,
  "rev-parse",
  "HEAD",
]);
if (
  revision.exitCode ||
  revision.stdout.toString().trim() !==
    "08e937b649bc7007c234bbd59e34a41d5eef3b38"
)
  throw Error("WWISER revision mismatch");
const archive = await Bun.file(`${research}/vgmstream-win64.zip`).arrayBuffer();
if (
  new Bun.CryptoHasher("sha256").update(archive).digest("hex") !==
  "6c4a8a3813864fefed081bbd337dbc0ad93bf88e0b92f5db98d7ab258b22dc6c"
)
  throw Error("vgmstream archive hash mismatch");
const child = Bun.spawn(
  [
    python,
    `${dirname(fileURLToPath(import.meta.url))}/export-audio.py`,
    research,
    cache,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await child.exited) throw Error("Audio export failed");
