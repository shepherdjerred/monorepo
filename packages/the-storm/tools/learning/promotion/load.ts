import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Digest } from "#learning/preference/gate.ts";
import { jsonText } from "#learning/preference/ledger.ts";
import { InferenceMetrics } from "#learning/inference.ts";
import { loadProtocol } from "#learning/load-gate.ts";
import { root } from "#learning/sandbox.ts";
import type { Snapshot } from "./archive.ts";
import { Proof, Native } from "./contract.ts";
import { nativeFingerprint, type Request } from "./collect.ts";
import { recomputeLoadEvidence } from "./load-evidence.ts";

const Inputs = z
  .object({
    native: Native,
    loadSources: z
      .array(z.object({ file: z.string(), sha256: Digest }).strict())
      .min(1),
    artifacts: z.object({ manifest: Digest, actor: Digest }).strict(),
    protocol: z.unknown(),
    acceptance: z.literal("unaccepted"),
    pilotAcceptanceChecked: z.literal(false),
    learnedControlEnabled: z.literal(false),
  })
  .strict();

export async function collectLoad(
  snapshot: Snapshot,
  request: Request,
  candidate: {
    actor_sha256: string;
    source_manifest_sha256: string;
    native_sha256: string;
  },
) {
  const inputFile = path.join(request.load, "inputs.json");
  const phaseFile = path.join(request.load, "phases.json");
  const logFile = path.join(request.load, "samples.jsonl");
  const resultFile = path.join(request.load, "verification.json");
  const inputs = Inputs.parse(await snapshot.json(inputFile));
  if (
    inputs.artifacts.actor !== candidate.actor_sha256 ||
    inputs.artifacts.manifest !== candidate.source_manifest_sha256 ||
    nativeFingerprint(inputs.native) !== candidate.native_sha256 ||
    JSON.stringify(inputs.protocol) !== JSON.stringify(loadProtocol)
  )
    throw new Error(
      "native load uses a different candidate, runtime or frozen protocol",
    );
  for (const file of [...inputs.native.hashes, ...inputs.loadSources])
    await snapshot.add(path.join(root, file.file), file.sha256);
  const raw = await snapshot.json(phaseFile);
  await snapshot.add(logFile);
  const verified = recomputeLoadEvidence(raw, await readFile(logFile, "utf8"));
  if (!verified.pass)
    throw new Error("original raw native load run fails promotion gates");
  await snapshot.add(resultFile);
  if (
    (await readFile(resultFile, "utf8")) !==
    jsonText({ ...inputs, ...verified })
  )
    throw new Error(
      "native load report differs from the original full command stream",
    );
  const measured = z
    .object({
      phases: z
        .array(
          z.object({
            after: z.object({ inference: InferenceMetrics.shape.inference }),
          }),
        )
        .length(3),
    })
    .parse(raw);
  const phases = verified.rows.map((row, index) => {
    const maximum = measured.phases[index]?.after.inference.maximumBatch;
    if (maximum === undefined)
      throw new Error("raw native load batch coverage is missing");
    return {
      bots: row.bots,
      ticks: row.ticks,
      live_ticks: row.liveTicks,
      full_roster_ticks: row.fullRosterTicks,
      submitted: row.submitted,
      skipped: row.skipped,
      rejected: row.rejected,
      deadline_met: row.deadlineMet,
      deadline_missed: row.deadlineMissed,
      maximum_batch: maximum,
      p95: row.p95,
      live_p95: row.liveP95,
      full_roster_p95: row.fullRosterP95,
      applied: row.applied,
      damage: row.damage,
      damage_events: row.damageEvents,
    };
  });
  return Proof.shape.load.parse({
    inputs_sha256: await snapshot.add(inputFile),
    phases_sha256: await snapshot.add(phaseFile),
    log_sha256: await snapshot.add(logFile),
    result_sha256: await snapshot.add(resultFile),
    cpus: loadProtocol.resources.cpus,
    heap: loadProtocol.resources.heap,
    memory_limit_bytes: 10 * 1024 ** 3,
    baseline_ticks: verified.baseline.ticks,
    baseline_p95: verified.baseline.p95,
    phases,
  });
}
