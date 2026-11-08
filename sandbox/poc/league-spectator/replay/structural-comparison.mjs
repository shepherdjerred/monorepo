import { StructuralDecoder } from "./structural-decoder.mjs";

const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (bytes) =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));

export async function compareStructural({
  uc,
  profile,
  image,
  constructors,
  samples,
  oracle,
  onResult = () => {},
}) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(constructors)) !== profile.constructorImageSha256
  )
    throw Error("Prepared decoder integrity check failed");
  if (
    samples.build !== profile.clientVersion ||
    samples.protocol !== profile.protocolDigest ||
    oracle.clientVersion !== profile.clientVersion ||
    oracle.decoderImageSha256 !== profile.decoderImageSha256 ||
    oracle.constructorImageSha256 !== profile.constructorImageSha256
  )
    throw Error("Sample/oracle build or decoder package mismatch");
  const decoder = new StructuralDecoder(uc, profile, image, constructors);
  const results = [];
  try {
    for (const [key, sample] of Object.entries(samples.packets)) {
      const opcode = sample.opcode ?? Number(key),
        expected = oracle.observations[key];
      if (!expected || !/^(?:[0-9a-f]{2})*$/i.test(sample.payloadHex))
        throw Error(`Invalid comparison input ${key}`);
      const payload = Uint8Array.from(
        sample.payloadHex.match(/../g) ?? [],
        (byte) => parseInt(byte, 16),
      );
      if (
        expected.payloadSha256 !== (await sha256(payload)) ||
        expected.param !== sample.param ||
        expected.opcode !== opcode
      )
        throw Error(`Native oracle input mismatch ${key}`);
      let result;
      try {
        const observed = decoder.observePacket(opcode, payload, sample.param);
        const match =
          expected.status === "complete" &&
          observed.complete &&
          observed.consumed === expected.consumed &&
          hex(observed.object) === expected.object &&
          hex(observed.heap) === expected.heap;
        result = {
          sampleId: key,
          opcode,
          status: match ? "matched" : "mismatch",
          inputBytes: payload.length,
          consumed: observed.consumed,
        };
      } catch (error) {
        // Native failures remain visible research gaps. They are never counted as
        // successful decoding even when both engines reject the same packet.
        result = {
          sampleId: key,
          opcode,
          status: expected.status === "error" ? "unresolved" : "mismatch",
          error: String(error),
          inputBytes: payload.length,
        };
        if (
          error instanceof WebAssembly.RuntimeError ||
          String(error).includes("RuntimeError:")
        )
          throw error;
      }
      results.push(result);
      onResult(result);
      if (results.length % 16 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    decoder.close();
  }
  return {
    schema: 1,
    build: profile.clientVersion,
    semanticFieldsVerified: false,
    matched: results.filter((r) => r.status === "matched").length,
    unresolved: results.filter((r) => r.status === "unresolved").length,
    mismatches: results.filter((r) => r.status === "mismatch").length,
    results,
  };
}
