import { describe, expect, it } from "vitest";
import {
  DRIFT_EVIDENCE_PREFIX,
  FINISH_EVIDENCE_PREFIX,
  MONITOR_ALARM_EVIDENCE_PREFIX,
  contentRecoveryEvidencePrefix,
  evidenceScope,
  evidenceScopeId,
  monitorEvidencePrefix,
  recordedByStage,
  recoveryEvidencePrefix,
  stageEvidencePrefix,
  stageEvidenceScopeId,
  workerRecoveryEvidencePrefix,
} from "./scope.ts";

const DEPLOYMENT = "45cf1828-0f01-4bcd-8dab-592769df488f";
const FINGERPRINT =
  "de12de3eb107c31adc57797fbe986f1793b3674298060fe1740142784a31b1e7";

/** An evidence id exactly as `evidence` writes it. */
function written(deploymentId: string, prefix: string, entry: string) {
  return `${evidenceScopeId(deploymentId, prefix)}${entry}`;
}

describe("the ids each writer produces", () => {
  it("keeps every prefix the stored evidence already uses", () => {
    expect(stageEvidencePrefix("step-sync")).toBe("stage/step-sync");
    expect(FINISH_EVIDENCE_PREFIX).toBe("finish");
    expect(monitorEvidencePrefix(3)).toBe("monitor/3");
    expect(MONITOR_ALARM_EVIDENCE_PREFIX).toBe("monitor/alarms");
    expect(DRIFT_EVIDENCE_PREFIX).toBe("drift");
    expect(recoveryEvidencePrefix("argo/model/beta/recovery")).toBe(
      "recovery/argo/model/beta/recovery",
    );
    expect(workerRecoveryEvidencePrefix("intent-1")).toBe(
      "worker-recovery/intent-1",
    );
    expect(contentRecoveryEvidencePrefix("intent-2")).toBe(
      "content-recovery/intent-2",
    );
  });

  it("scopes a writer's entries under the deployment", () => {
    expect(evidenceScopeId(DEPLOYMENT, "finish")).toBe(`${DEPLOYMENT}/finish/`);
    expect(stageEvidenceScopeId(DEPLOYMENT, "control-plane")).toBe(
      `${DEPLOYMENT}/stage/control-plane/`,
    );
    expect(written(DEPLOYMENT, stageEvidencePrefix("step-sync"), "0")).toBe(
      `${DEPLOYMENT}/stage/step-sync/0`,
    );
  });
});

describe("recordedByStage", () => {
  it("accepts an entry of exactly that stage, indexed or fingerprinted", () => {
    expect(
      recordedByStage(
        `${DEPLOYMENT}/stage/step-sync/0`,
        DEPLOYMENT,
        "step-sync",
      ),
    ).toBe(true);
    expect(
      recordedByStage(
        `${DEPLOYMENT}/stage/control-plane/${FINGERPRINT}`,
        DEPLOYMENT,
        "control-plane",
      ),
    ).toBe(true);
  });

  it("refuses a sub-stage's entry, another stage and another deployment", () => {
    expect(
      recordedByStage(
        `${DEPLOYMENT}/stage/step-sync/drain/0`,
        DEPLOYMENT,
        "step-sync",
      ),
    ).toBe(false);
    expect(
      recordedByStage(
        `${DEPLOYMENT}/stage/step-sync-2/0`,
        DEPLOYMENT,
        "step-sync",
      ),
    ).toBe(false);
    expect(
      recordedByStage("other/stage/step-sync/0", DEPLOYMENT, "step-sync"),
    ).toBe(false);
  });
});

describe("evidenceScope", () => {
  it("reads a stage's key and entry", () => {
    expect(
      evidenceScope(`${DEPLOYMENT}/stage/step-sync/0`, DEPLOYMENT),
    ).toEqual({ kind: "stage", key: "step-sync", entry: "0" });
  });

  it("matches the longest stage key, so a sub-stage keeps its own evidence", () => {
    expect(
      evidenceScope(`${DEPLOYMENT}/stage/step-sync/drain/1`, DEPLOYMENT),
    ).toEqual({ kind: "stage", key: "step-sync/drain", entry: "1" });
  });

  it("agrees with recordedByStage for every stage key", () => {
    const keys = ["step-sync", "step-sync/drain", "control-plane"];
    const ids = [
      `${DEPLOYMENT}/stage/step-sync/0`,
      `${DEPLOYMENT}/stage/step-sync/drain/0`,
      `${DEPLOYMENT}/stage/control-plane/${FINGERPRINT}`,
      `${DEPLOYMENT}/finish/0`,
    ];
    for (const id of ids)
      for (const key of keys) {
        const scope = evidenceScope(id, DEPLOYMENT);
        expect(scope.kind === "stage" && scope.key === key).toBe(
          recordedByStage(id, DEPLOYMENT, key),
        );
      }
  });

  it("reads a deployment id that itself contains a slash", () => {
    expect(
      evidenceScope("deployment/1/stage/worker-preflight/0", "deployment/1"),
    ).toEqual({ kind: "stage", key: "worker-preflight", entry: "0" });
  });

  it("reads what the executor reported with the result", () => {
    expect(evidenceScope(`${DEPLOYMENT}/finish/1`, DEPLOYMENT)).toEqual({
      kind: "finish",
      entry: "1",
    });
  });

  it("reads the monitor's alarms and its settled observation", () => {
    expect(
      evidenceScope(`${DEPLOYMENT}/monitor/alarms/${FINGERPRINT}`, DEPLOYMENT),
    ).toEqual({ kind: "monitor", part: "alarms", entry: FINGERPRINT });
    expect(
      evidenceScope(`${DEPLOYMENT}/monitor/2/${FINGERPRINT}`, DEPLOYMENT),
    ).toEqual({ kind: "monitor", part: "observation", entry: FINGERPRINT });
  });

  it("reads drift", () => {
    expect(
      evidenceScope(`${DEPLOYMENT}/drift/${FINGERPRINT}`, DEPLOYMENT),
    ).toEqual({ kind: "drift", entry: FINGERPRINT });
  });

  it("reads each recovery writer and an intent id that contains slashes", () => {
    expect(
      evidenceScope(
        `${DEPLOYMENT}/recovery/argo/model/beta/recovery/0`,
        DEPLOYMENT,
      ),
    ).toEqual({
      kind: "recovery",
      recovery: "argo",
      intentId: "argo/model/beta/recovery",
      entry: "0",
    });
    expect(
      evidenceScope(`${DEPLOYMENT}/worker-recovery/intent-1/2`, DEPLOYMENT),
    ).toEqual({
      kind: "recovery",
      recovery: "worker",
      intentId: "intent-1",
      entry: "2",
    });
    expect(
      evidenceScope(`${DEPLOYMENT}/content-recovery/intent-2/0`, DEPLOYMENT),
    ).toEqual({
      kind: "recovery",
      recovery: "content",
      intentId: "intent-2",
      entry: "0",
    });
  });

  it("round-trips every id the writers build", () => {
    const prefixes = [
      stageEvidencePrefix("step-sync"),
      FINISH_EVIDENCE_PREFIX,
      monitorEvidencePrefix(1),
      MONITOR_ALARM_EVIDENCE_PREFIX,
      DRIFT_EVIDENCE_PREFIX,
      recoveryEvidencePrefix("intent"),
      workerRecoveryEvidencePrefix("intent"),
      contentRecoveryEvidencePrefix("intent"),
    ];
    expect(
      prefixes.map(
        (prefix) =>
          evidenceScope(written(DEPLOYMENT, prefix, "0"), DEPLOYMENT).kind,
      ),
    ).toEqual([
      "stage",
      "finish",
      "monitor",
      "monitor",
      "drift",
      "recovery",
      "recovery",
      "recovery",
    ]);
  });

  it("reads an id of any other shape as other, never as a guess", () => {
    for (const id of [
      // An older or foreign row: not this deployment's prefix at all.
      "evidence/scout-prod-42/alarm",
      // This deployment, but a writer the grammar does not name.
      `${DEPLOYMENT}/attestation/0`,
      // No entry after the writer.
      `${DEPLOYMENT}/finish`,
      // A stage scope needs a key and an entry.
      `${DEPLOYMENT}/stage/0`,
      // The monitor writes under `alarms` or an observation's sequence.
      `${DEPLOYMENT}/monitor/window/0`,
      `${DEPLOYMENT}/monitor/1`,
      // A finish entry is one segment.
      `${DEPLOYMENT}/finish/extra/0`,
    ])
      expect(evidenceScope(id, DEPLOYMENT)).toEqual({ kind: "other" });
  });
});
