import type { DeploymentDetail } from "#shared/contract.ts";
import { NativeIntentHeading } from "./native-intent-heading.tsx";

type RecoveryDetail = {
  pipeline: Pick<DeploymentDetail["pipeline"], "definition">;
  deployment: Pick<
    DeploymentDetail["deployment"],
    "id" | "recoveryRequired" | "versionSetRevisionId"
  >;
  environment: Pick<DeploymentDetail["environment"], "generation">;
  contentRecoveries: DeploymentDetail["contentRecoveries"];
};

export function ContentRecovery({ detail }: { detail: RecoveryDetail }) {
  const policy = detail.pipeline.definition;
  if (policy.kind !== "argocd" && policy.kind !== "static-site") return null;
  const forum = policy.kind === "argocd" && policy.forumRelease !== undefined;
  const site = policy.kind === "static-site" || policy.scoutSite !== undefined;
  if (!forum && !site) return null;
  const domain = forum ? "forum" : "sites";
  const target =
    policy.kind === "static-site" ? policy.bucket : policy.application;
  return (
    <section aria-labelledby="content-recovery-heading">
      <h3 id="content-recovery-heading">
        Independent {forum ? "forum" : "site"} recovery
      </h3>
      {detail.deployment.recoveryRequired && (
        <div className="notice">
          <p>
            An administrator can request native inspection and bounded repair of
            this frozen release. Ownership stays locked until the original
            executor has stopped and independent evidence matches the held
            generation. A refused or failed repair keeps the lock.
          </p>
          <p>
            Recovery preserves the failed release and accepted version. It does
            not accept a deployment or reverse a database upgrade.
          </p>
          <pre>{`toolkit deploy ${domain} recover ${detail.deployment.id} --machine --expected-generation ${String(detail.environment.generation)} --reason "Inspect and settle the exact frozen release under retained ownership"`}</pre>
        </div>
      )}
      <dl className="component-list">
        <div>
          <dt>Held target</dt>
          <dd className="mono">{target}</dd>
        </div>
        <div>
          <dt>Frozen version set</dt>
          <dd className="mono">{detail.deployment.versionSetRevisionId}</dd>
        </div>
      </dl>
      {detail.contentRecoveries.length === 0 ? (
        <p className="muted">No independent content recovery requested.</p>
      ) : (
        <ul className="evidence">
          {detail.contentRecoveries.map((intent) => (
            <li key={intent.id}>
              <NativeIntentHeading intent={intent} />
              {intent.dispatchBarrier !== null &&
                intent.barrierRestoredAt === null && (
                  <p className="notice error">
                    Pending producer restoration. The original Activity host
                    must be restored through its exact native journal before
                    dispatch can resume.
                  </p>
                )}
              <small>
                Requested by {intent.requestedBy} ·{" "}
                {new Date(intent.createdAt).toLocaleString()}
              </small>
              <details>
                <summary>Frozen recovery operation and native receipts</summary>
                <pre>
                  {JSON.stringify(
                    {
                      targetKind: intent.targetKind,
                      deploymentId: intent.deploymentId,
                      environmentGeneration:
                        intent.expectedEnvironmentGeneration,
                      snapshotFingerprint: intent.snapshotFingerprint,
                      nativeReceipts: intent.nativeReceipts,
                      dispatchBarrier: intent.dispatchBarrier,
                      barrierRestoredAt: intent.barrierRestoredAt,
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
