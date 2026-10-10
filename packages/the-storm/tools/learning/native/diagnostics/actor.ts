import path from "node:path";
import { z } from "zod";
import { digestFile } from "#learning/preference/ledger.ts";

export const actorHashes = async (model: string) => ({
  manifest: await digestFile(path.join(model, "manifest.json")),
  actor: await digestFile(path.join(model, "actor.onnx")),
});

/** Diagnostics admit only unaccepted exports and still bind their exact ONNX bytes. */
export async function diagnosticManifest(model: string) {
  const manifest: unknown = await Bun.file(
    path.join(model, "manifest.json"),
  ).json();
  return z
    .object({
      schema: z.literal(1),
      kind: z.literal("rwf-trooper-ppo"),
      acceptance: z.literal("unaccepted"),
      onnx_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .parse(manifest);
}
