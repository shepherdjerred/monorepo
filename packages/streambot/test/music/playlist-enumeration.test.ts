import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { expandPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { runSubprocess } from "@shepherdjerred/streambot/sources/subprocess.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});
test("flat extraction drains 1500 entries in order, including duplicates and a final unterminated line", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "streambot-flat-playlist-"));
  dirs.push(dir);
  const executable = path.join(dir, "extractor");
  await Bun.write(
    executable,
    "#!" +
      process.execPath +
      "\n" +
      [
        "for (let i = 0; i < 1500; i += 1) {",
        " const id = String(i === 123 ? 1 : i).padStart(11, '0');",
        String.raw` const line = 'https://www.youtube.com/watch?v=' + id + '\tTrack ' + String(i) + (i === 1499 ? '' : '\n');`,
        " await Bun.write(Bun.stdout, line);",
        "}",
      ].join("\n"),
  );
  await chmod(executable, 0o755);
  const config = loadConfig({
    BOT_TOKEN: "fixture",
    USER_TOKENS: "fixture",
    VIDEOS_DIR: "/tmp",
    YT_DLP_PATH: executable,
  });
  const counts: number[] = [];
  const items = await expandPlaylist(
    config,
    "https://www.youtube.com/playlist?list=PLfixture",
    AbortSignal.timeout(10_000),
    (count) => {
      counts.push(count);
    },
  );
  expect(items).toHaveLength(1500);
  expect(items.map((item) => item.title)).toEqual(
    Array.from({ length: 1500 }, (_, i) => "Track " + String(i)),
  );
  expect(items[123]?.url).toBe(items[1]?.url);
  expect(counts).toEqual(Array.from({ length: 1500 }, (_, i) => i + 1));
});
test("incremental subprocess output retains UTF-8 characters across byte boundaries", async () => {
  const lines: string[] = [];
  const script = String.raw`const bytes = new TextEncoder().encode('Björk 🎵\n東京\nFinal'); for (const byte of bytes) await Bun.write(Bun.stdout, new Uint8Array([byte]));`;
  const result = await runSubprocess(
    [process.execPath, "-e", script],
    AbortSignal.timeout(10_000),
    (line) => {
      lines.push(line);
    },
  );
  expect(result.exitCode).toBe(0);
  expect(lines).toEqual(["Björk 🎵", "東京", "Final"]);
});
