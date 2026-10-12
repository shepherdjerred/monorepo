import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { jsonText, readJson, seal } from "#learning/preference/ledger.ts";
import { Digest } from "#learning/preference/gate.ts";
import { run } from "#learning/preference/media.ts";
import { root } from "#learning/sandbox.ts";
import { Snapshot, copyEvidence, hashFile } from "./archive.ts";
import { Proof, contract, Count } from "./contract.ts";
import {
  collectTraining,
  collectPreference,
  collectRegressions,
  type Request,
} from "./collect.ts";
import { collectParity } from "./numerical.ts";
import { collectLoad } from "./load.ts";

const Sealed = z
  .object({
    schema: z.literal(1),
    kind: z.literal("rwf-actor-promotion-result"),
    acceptance: z.literal("accepted"),
    actor_sha256: Digest,
    source_manifest_sha256: Digest,
    manifest_sha256: Digest,
    promotion_sha256: Digest,
    java_parity: z
      .object({
        batches: z.array(Count),
        steps: z.literal(contract.paritySteps),
        maximumAbsoluteError: z.number().nonnegative(),
      })
      .strict(),
    learned_control_enabled: z.literal(false),
  })
  .strict();

/** Assemble only original verified evidence. Failed outputs stay unaccepted and cannot be overwritten. */
export async function prepareBundle(request: Request) {
  const snapshot = new Snapshot();
  const candidate = await collectTraining(snapshot, request);
  const preference = await collectPreference(snapshot, request, candidate);
  const parity = await collectParity(snapshot, request, candidate);
  const load = await collectLoad(snapshot, request, candidate);
  const regressions = await collectRegressions(snapshot, request, candidate);
  const contractFile = path.join(
    root,
    "plugin/modules/rwfbots/src/main/resources/rwf-actor-promotion.json",
  );
  const contractSha = await snapshot.add(contractFile);
  for (const file of [
    "archive.ts",
    "bundle.ts",
    "collect.ts",
    "contract.ts",
    "load.ts",
    "numerical.ts",
    "index.ts",
  ])
    await snapshot.add(path.join(root, "tools/learning/promotion", file));
  await snapshot.add(path.join(root, "tools/learning/promotion/parity.py"));
  await snapshot.verify();
  await mkdir(path.dirname(request.output), { recursive: true });
  await mkdir(request.output, { mode: 0o700 });
  await mkdir(path.join(request.output, "evidence"), { mode: 0o700 });
  await seal(
    path.join(request.output, "collection.json"),
    jsonText({
      schema: 1,
      kind: "rwf-actor-promotion-collection",
      acceptance: "unaccepted",
      request,
      files: snapshot.files(),
    }),
  );
  const files = await snapshot.archive(request.output);
  await copyEvidence(
    path.join(request.model, "actor.onnx"),
    path.join(request.output, "actor.onnx"),
    candidate.actor_sha256,
  );
  await copyEvidence(
    path.join(request.model, "manifest.json"),
    path.join(request.output, "source-manifest.json"),
    candidate.source_manifest_sha256,
  );
  const proof = Proof.parse({
    schema: contract.version,
    kind: contract.kind,
    promotion_contract_sha256: contractSha,
    ...candidate,
    preference,
    parity,
    load,
    regressions,
    files,
  });
  await seal(path.join(request.output, "promotion.json"), jsonText(proof));
  await snapshot.verify();
  return proof;
}

/** Java replays the sealed receipt and checks the complete portable bundle before its exclusive write. */
export async function promote(request: Request) {
  const proof = await prepareBundle(request);
  await run([
    "mise",
    "exec",
    "--",
    "gradle",
    "-p",
    path.join(root, "plugin"),
    ":rwfbots:actorPromotion",
    `-PactorPromotionDirectory=${request.output}`,
    `-PactorPromotionSource=${request.model}`,
    "--console=plain",
  ]);
  const result = Sealed.parse(
    await readJson(path.join(request.output, "promotion-result.json")),
  );
  if (
    result.actor_sha256 !== proof.actor_sha256 ||
    result.source_manifest_sha256 !== proof.source_manifest_sha256 ||
    result.manifest_sha256 !==
      (await hashFile(path.join(request.output, "manifest.json"))) ||
    result.promotion_sha256 !==
      (await hashFile(path.join(request.output, "promotion.json"))) ||
    JSON.stringify(result.java_parity.batches) !==
      JSON.stringify(contract.parityBatches)
  )
    throw new Error(
      "sealed Java promotion result differs from original evidence",
    );
  const source = z
    .record(z.string(), z.unknown())
    .parse(
      JSON.parse(
        await readFile(
          path.join(request.output, "source-manifest.json"),
          "utf8",
        ),
      ),
    );
  const manifest = await readJson(path.join(request.output, "manifest.json"));
  if (
    JSON.stringify(manifest) !==
    JSON.stringify({
      ...source,
      acceptance: "accepted",
      promotion_sha256: result.promotion_sha256,
    })
  )
    throw new Error(
      "sealed accepted manifest differs from its original export",
    );
  return result;
}
