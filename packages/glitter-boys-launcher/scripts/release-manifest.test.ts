import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  compareVersions,
  renewManifest,
  signRelease,
  verifyPublication,
  type Release,
} from "./release-manifest.ts";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keys = [
  publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex"),
];
function fixture(): Release {
  return {
    schema: 1,
    version: "0.1.7",
    channel: "preview",
    target: "x86_64-pc-windows-msvc",
    minimum_bootstrap: 1,
    expires: Math.floor(Date.now() / 1000) + 3600,
    expanded_bytes: 100,
    executable_sha256: "b".repeat(64),
    artifact: {
      file: "launcher.zip",
      url: "https://glitter-boys.com/launcher/releases/0.1.7/launcher.zip",
      bytes: 10,
      sha256: "a".repeat(64),
    },
  };
}
test("renewal changes only expiry and signature, including an expired release", () => {
  const release = { ...fixture(), expires: 1 };
  const original = signRelease(release, privateKey);
  expect(() => verifyPublication(original, keys, "preview")).toThrow();
  const envelope = renewManifest(original, keys, "preview", privateKey);
  const renewed = verifyPublication(envelope, keys, "preview");
  expect({ ...renewed, expires: release.expires }).toEqual(release);
  expect(renewed.expires).toBeGreaterThan(Date.now() / 1000 + 89 * 86400);
  expect(envelope.signature).not.toBe(original.signature);
  expect(() =>
    renewManifest(
      { ...original, payload: original.payload + " " },
      keys,
      "preview",
      privateKey,
    ),
  ).toThrow();
  expect(() =>
    renewManifest(
      original,
      keys,
      "preview",
      generateKeyPairSync("ed25519").privateKey,
    ),
  ).toThrow();
});
test("publication rejects signed metadata that installed clients cannot accept", () => {
  for (const change of [
    { target: "aarch64-apple-darwin" },
    { minimum_bootstrap: 2 },
    { expanded_bytes: 0 },
    { version: "00.1.7" },
    { unexpected: true },
    { expires: 1 },
  ])
    expect(() =>
      verifyPublication(
        signRelease({ ...fixture(), ...change } as Release, privateKey),
        keys,
        "preview",
      ),
    ).toThrow();
  expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
  expect(compareVersions("0.1.7", "0.1.7")).toBe(0);
  expect(compareVersions("0.1.6", "0.1.7")).toBe(-1);
  expect(() => compareVersions("01.1.7", "0.1.7")).toThrow();
});
