import { LatestParticleWorkerClient } from "./latest-particle-worker-client.mjs";
import { TARGETED_MISSILE_PRESENTATION_POLICY } from "./latest-targeted-missile-presentation.mjs";
import { FIXED_TIME_PRESENTATION_POLICY } from "./latest-fixed-time-presentation.mjs";
import { MISSILE_PRESENTATION_FAMILIES_POLICY } from "./latest-missile-presentation-families.mjs";
import { DIRECT_MISSILE_PRESENTATION_POLICY } from "./latest-direct-missile-presentation.mjs";
import { sameDirectCompiledData } from "./latest-direct-compiled-restore.mjs";
import { assertLatestStaticCatalogInitialization } from "./latest-static-catalog.mjs";

// One bounded diagnostic preparation over shared translated kernels. No motion
// simulation or guest instructions execute on the spectator's main thread.
export async function requestTargetedMissilePresentation(payload) {
  const { onPreparationMetrics, ...workerPayload } = payload;
  if (
    onPreparationMetrics !== undefined &&
    typeof onPreparationMetrics !== "function"
  )
    throw Error("Targeted preparation metrics callback must be a function");
  const report = payload?.report;
  if (payload?.staticCatalogInitialization !== undefined)
    assertLatestStaticCatalogInitialization(
      payload.staticCatalogInitialization,
    );
  if (
    payload?.includeDirectMissilePresentation !== undefined &&
    typeof payload.includeDirectMissilePresentation !== "boolean"
  )
    throw Error("Explicit direct missile preparation option required");
  if (
    payload?.family !== undefined &&
    !["fixed-speed", "fixed-time", "all"].includes(payload.family)
  )
    throw Error("Explicit verified missile presentation family required");
  if (
    !report ||
    !/^[a-f0-9]{64}$/.test(report.replaySha256) ||
    !Number.isFinite(report.endTime) ||
    report.endTime <= 0
  )
    throw Error("Targeted worker requires an identified bounded replay prefix");
  const expected = {
    build: report.build,
    protocol: report.protocol,
    replaySha256: report.replaySha256,
    endTime: report.endTime,
    policy:
      payload.family === "all"
        ? MISSILE_PRESENTATION_FAMILIES_POLICY
        : payload.family === "fixed-time"
          ? FIXED_TIME_PRESENTATION_POLICY
          : TARGETED_MISSILE_PRESENTATION_POLICY,
  };
  const client = new LatestParticleWorkerClient({
    workerUrl: new URL("./latest-targeted-missile-worker.mjs", import.meta.url),
  });
  const handleMessage = client.worker.onmessage;
  let preparationMetrics;
  client.worker.onmessage = (event) => {
    const data = event.data;
    if (data?.version === 1 && data.id === 1 && data.ok === true) {
      const metrics = data.preparationMetrics;
      if (
        !metrics ||
        !Number.isSafeInteger(metrics.candidateRecords) ||
        metrics.candidateRecords < 0 ||
        typeof metrics.namedPoseAssetsLoaded !== "boolean" ||
        ![metrics.scanElapsedMs, metrics.elapsedMs].every(
          (value) => Number.isFinite(value) && value >= 0,
        ) ||
        ![metrics.uniqueStaticInputFiles, metrics.uniqueStaticInputBytes].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        typeof metrics.scope !== "string"
      ) {
        client.fail(
          Error("Targeted worker preparation metrics missing or invalid"),
        );
        return;
      }
      preparationMetrics = structuredClone(metrics);
    }
    handleMessage(event);
  };
  const timer = setTimeout(
    () =>
      client.fail(
        Error(
          "Targeted presentation worker exceeded bounded preparation window",
        ),
      ),
    120000,
  );
  try {
    const result = await client.request("prepare", workerPayload);
    if (
      payload.staticCatalogInitialization !== undefined &&
      !sameDirectCompiledData(
        result?.staticCatalogInventory,
        payload.staticCatalogInitialization.inventory,
      )
    )
      throw Error("Targeted worker restored a different static selection");
    if (
      !result ||
      Object.entries(expected).some(([key, value]) => result[key] !== value)
    )
      throw Error("Targeted worker returned a stale or foreign replay prefix");
    if (
      payload.includeDirectMissilePresentation &&
      (!result.directMissilePresentation ||
        result.directMissilePresentation.policy !==
          DIRECT_MISSILE_PRESENTATION_POLICY ||
        ["build", "protocol", "replaySha256", "endTime"].some(
          (key) => result.directMissilePresentation[key] !== expected[key],
        ))
    )
      throw Error(
        "Targeted worker returned a missing or foreign direct missile prefix",
      );
    onPreparationMetrics?.(preparationMetrics);
    return structuredClone(result);
  } finally {
    clearTimeout(timer);
    client.close();
    await client.termination;
  }
}
