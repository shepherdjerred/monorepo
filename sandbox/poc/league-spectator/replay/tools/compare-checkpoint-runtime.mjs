import path from "node:path";
import { pathToFileURL } from "node:url";
import { originalCheckpointCacheSource } from "./checkpoint-cache-control-source.mjs";
import { checkpointCacheRuntimeControl } from "./checkpoint-cache-browser-control.mjs";
import { compareCheckpointStateParts } from "./checkpoint-state-comparison.mjs";
import { sameCheckpointData } from "./checkpoint-data-equality.mjs";
import { ownDirectWorkerEventInput } from "../latest-direct-event-ownership.mjs";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";

// The caller supplies live inputs from the actual ordinary session preparer.
// This diagnostic changes only cache policy; native programs, absolute-time
// world queries, particle kernels and every state/draw field remain identical.
// No browser/GPU/performance acceptance is inferred from this offline control.
export async function compareCheckpointRuntime({
  runtimeInputs,
  times,
  camera,
  runtimePair = null,
  onStage = () => {},
}) {
  const runtimePath = path.resolve(
      import.meta.dir,
      "../latest-direct-effect-runtime.mjs",
    ),
    roots = [pathToFileURL(runtimePath), new URL(import.meta.url)],
    sourceBefore = await captureResearchSourceClosure(roots),
    originalSource = (await Bun.file(runtimePath).text()).replaceAll(
      "\r\n",
      "\n",
    );
  const baselineSource = originalCheckpointCacheSource(originalSource);
  const importRuntime = async (source) => {
    const controlled = checkpointCacheRuntimeControl(source).replace(
      /from "(\.\/[^\"]+)"/g,
      (_, dependency) =>
        `from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(runtimePath), dependency)).href)}`,
    );
    return (
      await import(
        `data:text/javascript;base64,${Buffer.from(controlled).toString("base64")}`
      )
    ).LatestDirectEffectRuntime;
  };
  if (
    runtimePair !== null &&
    (runtimePair.originalSourceSha256 !==
      new Bun.CryptoHasher("sha256").update(originalSource).digest("hex") ||
      runtimePair.baselineSourceSha256 !==
        new Bun.CryptoHasher("sha256").update(baselineSource).digest("hex") ||
      typeof runtimePair.Baseline !== "function" ||
      typeof runtimePair.Candidate !== "function")
  )
    throw Error("Exact source-bound checkpoint runtime pair required");
  // A bundled actual session must supply constructors from its own graph so
  // private compiler capabilities retain their original module-instance owner.
  const Baseline =
      runtimePair?.Baseline ?? (await importRuntime(baselineSource)),
    Candidate = runtimePair?.Candidate ?? (await importRuntime(originalSource));
  const instantiate = (Runtime) => {
    // A public constructor also accepts caller-owned input and makes its own
    // independent copy. Never mint a ticket in a different module registry.
    const constructorCopy = runtimePair !== null && !runtimePair.ownEvents;
    const events = constructorCopy
      ? runtimeInputs.events
      : structuredClone(runtimeInputs.events);
    return new Runtime({
      ...runtimeInputs,
      events,
      eventsOwnership: constructorCopy
        ? null
        : (runtimePair?.ownEvents ?? ownDirectWorkerEventInput)(events),
    });
  };
  onStage({ stage: "baseline-create" });
  const baseline = instantiate(Baseline);
  onStage({ stage: "candidate-create" });
  const candidate = instantiate(Candidate),
    comparisons = [];
  for (const time of times) {
    const steps = [
        baseline.metrics.simulationSteps,
        candidate.metrics.simulationSteps,
      ],
      started = performance.now();
    onStage({ stage: "baseline-advance", time });
    baseline.advanceTo(time);
    const baselineMs = performance.now() - started;
    onStage({ stage: "candidate-advance", time });
    const candidateStarted = performance.now();
    candidate.advanceTo(time);
    const candidateMs = performance.now() - candidateStarted;
    onStage({ stage: "state-compare", time });
    const comparedRows = compareCheckpointStateParts(
      baseline.__checkpointCacheStateControl(),
      candidate.__checkpointCacheStateControl(),
    );
    const beforeDraw = [
        baseline.metrics.simulationSteps,
        candidate.metrics.simulationSteps,
      ],
      expectedDraws = baseline.generateDraws(camera).draws,
      actualDraws = candidate.generateDraws(camera).draws;
    if (!sameCheckpointData(expectedDraws, actualDraws))
      throw Error(`Checkpoint cache particle geometry differs at ${time}`);
    if (
      baseline.metrics.simulationSteps !== beforeDraw[0] ||
      candidate.metrics.simulationSteps !== beforeDraw[1]
    )
      throw Error("Checkpoint comparison camera draw advanced simulation");
    const row = {
      time,
      matched: true,
      comparedRows,
      activeInstances: candidate.instances.size,
      drawPackets: actualDraws.length,
      baselineSteps: baseline.metrics.simulationSteps - steps[0],
      candidateSteps: candidate.metrics.simulationSteps - steps[1],
      baselineMs,
      candidateMs,
    };
    comparisons.push(row);
    onStage({ stage: "matched", ...row });
  }
  const sourceAfter = await captureResearchSourceClosure(roots);
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter))
    throw Error("Checkpoint comparison source changed during execution");
  const sha256 = (text) =>
    new Bun.CryptoHasher("sha256").update(text).digest("hex");
  return {
    scope:
      "Offline original cache versus current cache under actual session-prepared inputs; full ordered histories, active particle/RNG state and exact geometry. Shared absolute-time world query service; no browser/GPU/native fidelity or production acceptance claim.",
    comparisons,
    eventInitialization:
      runtimePair !== null && !runtimePair.ownEvents
        ? "independent-original-constructor-copies"
        : "independently-owned-event-copies",
    runtimeSha256: sha256(originalSource),
    baselineSha256: sha256(baselineSource),
    sourceBefore,
    sourceAfter,
    sourceDrift: [],
  };
}
