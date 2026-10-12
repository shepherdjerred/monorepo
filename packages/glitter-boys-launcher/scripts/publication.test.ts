import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyPublication } from "./release-manifest.ts";
test("publication authenticates version and destination before any upload", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex");
  const fixture = (
    url = "https://glitter-boys.com/launcher/releases/0.1.1/launcher.zip",
  ) => {
    const payload = JSON.stringify({
      schema: 1,
      version: "0.1.1",
      channel: "preview",
      target: "x86_64-pc-windows-msvc",
      minimum_bootstrap: 1,
      expanded_bytes: 10,
      executable_sha256: "b".repeat(64),
      expires: Math.floor(Date.now() / 1000) + 3600,
      artifact: { file: "launcher.zip", url, bytes: 1, sha256: "a".repeat(64) },
    });
    return {
      payload,
      signature: sign(
        null,
        Buffer.from(`glitter-boys-release-v1\n${payload}`),
        privateKey,
      ).toString("hex"),
    };
  };
  expect(verifyPublication(fixture(), [key], "preview").version).toBe("0.1.1");
  expect(() =>
    verifyPublication({ ...fixture(), payload: "tampered" }, [key], "preview"),
  ).toThrow();
  expect(() =>
    verifyPublication(fixture("https://example.com/payload"), [key], "preview"),
  ).toThrow();
  expect(() => verifyPublication(fixture(), [key], "stable")).toThrow();
});
