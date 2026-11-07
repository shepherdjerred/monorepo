import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXE_SHA256, FIXTURE_SHA256 } from "../decoder.mjs";
if (!process.argv[2])
  throw Error("Usage: bun tools/fixture.mjs <research-root>");
const root = resolve(process.argv[2]);
const replay = Bun.file(`${root}/KR_8305643709.rofl`);
if (!(await replay.exists())) {
  const response = await fetch(
    "https://github.com/ss26367098/rofllens/releases/download/v0.1.0/KR_8305643709.rofl",
  );
  if (!response.ok) throw Error(`Replay download HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
    FIXTURE_SHA256
  )
    throw Error("Fixture hash mismatch");
  await Bun.write(replay, bytes);
}
if (
  new Bun.CryptoHasher("sha256")
    .update(await replay.arrayBuffer())
    .digest("hex") !== FIXTURE_SHA256
)
  throw Error("Cached fixture hash mismatch");
const executable = Bun.file(`${root}/League of Legends.exe`);
if (!(await executable.exists())) {
  const { downloadVersion } = await import(
    pathToFileURL(`${root}/lol-exe-downloader/src/index.js`).href
  );
  await downloadVersion("16.14.7945912", { outputPath: executable.name });
}
if (
  new Bun.CryptoHasher("sha256")
    .update(await executable.arrayBuffer())
    .digest("hex") !== EXE_SHA256
)
  throw Error("Executable hash mismatch");
console.log(
  "Fixture and offline executable hashes verified. The executable was not launched.",
);
