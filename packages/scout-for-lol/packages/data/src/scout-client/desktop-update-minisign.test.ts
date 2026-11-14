import { describe, expect, test } from "vitest";
import { verifyMinisign } from "./desktop-update-minisign.ts";

// The Rust client's tests verify these same files with `minisign-verify`, so a
// signature that passes here is one the client accepts, and the reverse.
const fixtures = new URL(
  "../../../desktop/crates/scout-client-app/src/updater/testdata/",
  import.meta.url,
);
const read = async (name: string) =>
  Buffer.from(await Bun.file(new URL(name, fixtures)).arrayBuffer());
const text = async (name: string) => {
  const bytes = await read(name);
  return bytes.toString("utf8").trim();
};

const publicKeyBase64 = await text("test-key.pub");
const otherPublicKeyBase64 = await text("other-key.pub");
const signatureBase64 = await text("payload.sig");
const data = await read("payload.bin");

describe("minisign verification of desktop installers", () => {
  test("accepts a good signature from the cargo-packager key", () => {
    expect(() => {
      verifyMinisign({ publicKeyBase64, signatureBase64, data });
    }).not.toThrow();
  });

  test("rejects a tampered file", () => {
    const tampered = Buffer.from(data);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() => {
      verifyMinisign({ publicKeyBase64, signatureBase64, data: tampered });
    }).toThrow(/does not match/);
  });

  test("rejects a signature by a different key", () => {
    expect(() => {
      verifyMinisign({
        publicKeyBase64: otherPublicKeyBase64,
        signatureBase64,
        data,
      });
    }).toThrow(/different key/);
  });

  test("rejects an altered trusted comment", () => {
    const lines = Buffer.from(signatureBase64, "base64")
      .toString("utf8")
      .split("\n");
    const altered = lines
      .map((line) => (line.startsWith("trusted comment: ") ? `${line}x` : line))
      .join("\n");
    expect(() => {
      verifyMinisign({
        publicKeyBase64,
        signatureBase64: Buffer.from(altered).toString("base64"),
        data,
      });
    }).toThrow(/trusted comment/);
  });

  test("rejects garbage", () => {
    expect(() => {
      verifyMinisign({ publicKeyBase64, signatureBase64: "AAAA", data });
    }).toThrow();
    expect(() => {
      verifyMinisign({ publicKeyBase64: "AAAA", signatureBase64, data });
    }).toThrow();
  });
});
