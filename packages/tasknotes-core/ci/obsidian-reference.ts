import { createHash, scrypt, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

// Explicit maintenance command, never part of app runtime or ordinary tests.
// Only the pinned client's crypto functions execute; CLI startup, filesystem,
// authentication, SQLite, and networking code are excluded.
const referenceUrl =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-headless/0d0ec4364bfde6c715c539cf3555ff8272bb7a58/cli.js";
const sourceSha256 =
  "c6307dc72c00bcf6f22093fb3e0eb91fdc417fc9dd05884ff2c36e5a19cd0196";
const response = await fetch(referenceUrl);
if (!response.ok)
  throw new Error(`Reference download failed: ${String(response.status)}`);
const source = await response.text();
if (createHash("sha256").update(source).digest("hex") !== sourceSha256) {
  throw new Error(
    "Official client source hash differs from the pinned reference.",
  );
}

function segment(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (
    start < 0 ||
    end <= start ||
    source.indexOf(startMarker, start + 1) >= 0
  ) {
    throw new Error("Reference crypto extraction boundaries changed.");
  }
  return source.slice(start, end);
}

const publicInputs = {
  // Public synthetic fixture material. These are never account credentials.
  password: "Å synthetic fixture １２３",
  salt: "ｖault-test-salt",
  paths: [
    "",
    "Tasks/Write plan.md",
    ".obsidian/plugins/tasknotes/data.json",
    "Tasks/日本語 📝.md",
  ],
  plaintext: [0, 1, 2, 127, 128, 255, 10, 65],
  nonce: Array.from({ length: 12 }, (_, index) => index),
};
const context = {
  Buffer,
  TextEncoder,
  TextDecoder,
  crypto: {
    subtle: webcrypto.subtle,
    // Deterministic entropy exists exclusively inside this fixture sandbox.
    getRandomValues: (bytes: Uint8Array) => {
      if (bytes.length !== 12)
        throw new Error("Unexpected reference nonce size.");
      bytes.set(publicInputs.nonce);
      return bytes;
    },
  },
  require: (name: string) => {
    if (name !== "crypto")
      throw new Error("Reference requested a non-crypto module.");
    return { scrypt };
  },
  fixtureInput: publicInputs,
};

const program = [
  segment("function se(s)", "function Rs(s)"),
  segment("async function Qe(s)", "var lc="),
  segment("var It=", "var os="),
  `(async () => {
    const key = await Or(fixtureInput.password, fixtureInput.salt);
    const cases = [];
    for (const version of [0, 2, 3]) {
      const cipher = await kc(version, key, fixtureInput.salt);
      const strings = [];
      for (const path of fixtureInput.paths) strings.push({plaintext:path, ciphertext:await cipher.deterministicEncodeStr(path)});
      const plaintext = new Uint8Array(fixtureInput.plaintext);
      cases.push({version,keyHashBytes:Array.from(Buffer.from(cipher.keyHash, "hex")),strings,content:Array.from(new Uint8Array(await cipher.encrypt(plaintext.buffer))),emptyContent:Array.from(new Uint8Array(await cipher.encrypt(new ArrayBuffer(0))))});
    }
    return {derivedBytes:Array.from(new Uint8Array(key)),cases};
  })()`,
].join("\n");
const vectors: unknown = await runInNewContext(program, context, {
  timeout: 5000,
});
const output = new URL(
  "../../tasknotes-fixtures/vault/upstream/obsidian-crypto.json",
  import.meta.url,
);
await Bun.write(
  output,
  `${JSON.stringify({ referenceUrl, sourceSha256, inputs: publicInputs, vectors }, null, 2)}\n`,
);
