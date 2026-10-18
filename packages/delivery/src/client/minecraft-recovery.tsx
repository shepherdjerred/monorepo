import type { DeploymentDetail } from "#shared/contract.ts";
import { NativeIntentHeading } from "./native-intent-heading.tsx";

export function MinecraftRecovery({ detail }: { detail: DeploymentDetail }) {
  if (
    detail.pipeline.definition.kind !== "argocd" ||
    detail.pipeline.definition.minecraftUpgrade === undefined
  )
    return null;
  const sourceSelected = detail.stages.some(
    (stage) => stage.key === "reconcile",
  );
  return (
    <section aria-labelledby="minecraft-recovery-heading">
      <h3 id="minecraft-recovery-heading">Original server recovery</h3>
      {detail.deployment.recoveryRequired && (
        <div className="notice">
          {sourceSelected ? (
            <p>
              Candidate source selection was admitted. Keep ownership and follow
              the independent world restoration procedure; routine cleanup
              cannot release this lock.
            </p>
          ) : (
            <>
              <p>
                An admin can request recovery of the unchanged original server.
                The controller cleans only this request’s validation copy and
                reopens the original. Independent volume, route, Pod, and Argo
                readback must pass before the lock is released. The failed
                release remains failed.
              </p>
              <pre>{`toolkit deploy minecraft recover ${detail.deployment.id} --machine --expected-generation ${String(detail.environment.generation)} --reason "Inspect the original before candidate source selection"`}</pre>
            </>
          )}
        </div>
      )}
      {detail.minecraftRecoveries.length === 0 ? (
        <p className="muted">No independent recovery has been requested.</p>
      ) : (
        <ul className="evidence">
          {detail.minecraftRecoveries.map((intent) => (
            <li key={intent.id}>
              <NativeIntentHeading intent={intent} />
              <small>
                Requested by {intent.requestedBy} ·{" "}
                {new Date(intent.createdAt).toLocaleString()}
              </small>
              <details>
                <summary>Frozen recovery identity</summary>
                <pre>
                  {JSON.stringify(
                    {
                      workflowId: intent.workflowId,
                      environmentGeneration:
                        intent.expectedEnvironmentGeneration,
                      snapshotFingerprint: intent.snapshotFingerprint,
                      controller: intent.controllerReceipt,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
