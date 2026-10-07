import path from "node:path";
import { z } from "zod";
import { Digest } from "#learning/preference/gate.ts";
import { run } from "#learning/preference/media.ts";
import { root } from "#learning/sandbox.ts";
import type { Snapshot } from "./archive.ts";
import { Proof, Count, contract } from "./contract.ts";
import type { Request } from "./collect.ts";

const Binding = z
  .object({
    onnx_sha256: Digest,
    actor_manifest_sha256: Digest,
    checkpoint_manifest_sha256: Digest,
    weights_sha256: Digest,
    contract_sha256: Digest,
    samples_sha256: Digest,
  })
  .strict();
const Receipt = z
  .object({
    schema: z.literal(1),
    kind: z.literal("rwf-actor-parity"),
    acceptance: z.literal("unaccepted"),
    backend: z.literal("onnxruntime-java-cpu"),
    parity_contract_sha256: Digest,
    artifacts: Binding,
    rtol: z.literal(contract.rtol),
    atol: z.literal(contract.atol),
    replay: z
      .object({
        batches: z.array(Count),
        steps: z.literal(contract.paritySteps),
        maximumAbsoluteError: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

export async function collectParity(
  snapshot: Snapshot,
  request: Request,
  candidate: {
    actor_sha256: string;
    source_manifest_sha256: string;
    checkpoint_manifest_sha256: string;
    weights_sha256: string;
  },
) {
  const sampleFile = path.join(request.parity, "samples.json");
  const sampleSha = await snapshot.add(sampleFile);
  const source = z
    .object({ contract_sha256: Digest })
    .parse(await snapshot.json(path.join(request.model, "manifest.json")));
  const expected = Binding.parse({
    onnx_sha256: candidate.actor_sha256,
    actor_manifest_sha256: candidate.source_manifest_sha256,
    checkpoint_manifest_sha256: candidate.checkpoint_manifest_sha256,
    weights_sha256: candidate.weights_sha256,
    contract_sha256: source.contract_sha256,
    samples_sha256: sampleSha,
  });
  const receipt = Receipt.parse(await snapshot.json(request.receipt));
  const parityContract = path.join(
    root,
    "plugin/modules/rwfbots/src/main/resources/rwf-actor-parity.json",
  );
  if (
    JSON.stringify(receipt.artifacts) !== JSON.stringify(expected) ||
    receipt.parity_contract_sha256 !== (await snapshot.add(parityContract)) ||
    JSON.stringify(receipt.replay.batches) !==
      JSON.stringify(contract.parityBatches)
  )
    throw new Error(
      "original Java parity receipt differs from this exact candidate",
    );
  for (const [name, digest] of [
    ["actor.onnx", candidate.actor_sha256],
    ["manifest.json", candidate.source_manifest_sha256],
  ] as const)
    await snapshot.add(path.join(request.parity, "onnx", name), digest);
  const result: unknown = JSON.parse(
    await run([
      "uv",
      "run",
      "--directory",
      path.join(root, "tools/learning"),
      "--locked",
      "python",
      "-m",
      "promotion.parity",
      "--checkpoint",
      path.join(request.pilot, "seed-0/learning/final"),
      "--actor",
      request.model,
      "--verify-samples",
      sampleFile,
    ]),
  );
  const checked = z.object({ samples_sha256: Digest }).strict().parse(result);
  if (checked.samples_sha256 !== sampleSha)
    throw new Error("Python parity verified different samples");
  await snapshot.verify();
  return Proof.shape.parity.parse({
    receipt_sha256: await snapshot.add(request.receipt),
    samples_sha256: sampleSha,
    batches: receipt.replay.batches,
    steps: receipt.replay.steps,
    rtol: receipt.rtol,
    atol: receipt.atol,
  });
}
