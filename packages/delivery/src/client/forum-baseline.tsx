import type {
  Environment,
  ForumBaselineIntent,
  DeploymentDetail,
} from "#shared/contract.ts";
import { NativeIntentHeading } from "./native-intent-heading.tsx";

export function ForumBaselinePanel({
  environment,
  intents,
}: {
  environment: Environment;
  intents: ForumBaselineIntent[];
}) {
  if (environment.serviceId !== "storm-forum") return null;
  const history = intents.filter(
    (intent) => intent.environmentId === environment.id,
  );
  return (
    <section className="panel" aria-labelledby="forum-baseline-heading">
      <h2 id="forum-baseline-heading">Original forum baseline</h2>
      <p>
        An initial upgrade requires independently observed installed XenForo,
        licensed bundle, runtime digest, and completed release Job. This
        read-only baseline preserves original provenance; deployment acceptance
        follows the actual upgrade.
      </p>
      {environment.acceptedForumBaselineIntentId === null &&
        environment.acceptedVersionSetRevisionId === null && (
          <div className="notice">
            <p>
              Publish the private bundle descriptor, wait for independent
              qualification, then request an admin baseline with exact original
              image and bundle artifact IDs.
            </p>
            <pre>{`toolkit deploy forum publish --file delivery-bundle.json --machine\ntoolkit deploy forum baseline --file original-forum-baseline.json --machine`}</pre>
            <p>
              Expected environment generation:{" "}
              <strong>{environment.generation}</strong>. The baseline request
              uses this generation and a reason.
            </p>
          </div>
        )}
      {history.length === 0 ? (
        <p className="muted">No original baseline requested.</p>
      ) : (
        <ul className="evidence">
          {history.map((intent) => (
            <li key={intent.id}>
              <NativeIntentHeading intent={intent} />
              <p className="mono">
                Image {intent.imageArtifactId}
                <br />
                Licensed bundle {intent.bundleArtifactId}
              </p>
              <details>
                <summary>Original native provenance</summary>
                <pre>
                  {JSON.stringify(
                    {
                      environmentGeneration:
                        intent.expectedEnvironmentGeneration,
                      pipeline: intent.pipelineRevisionId,
                      configuration: intent.configurationRevision,
                      snapshotFingerprint: intent.snapshotFingerprint,
                      workflowId: intent.workflowId,
                      proof: intent.proof,
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

export function FrozenForumBaseline({ detail }: { detail: DeploymentDetail }) {
  const baseline = detail.deployment.forumBaselineSnapshot;
  if (baseline === null) return null;
  return (
    <section aria-labelledby="frozen-forum-heading">
      <h3 id="frozen-forum-heading">Frozen original forum</h3>
      <p>
        Pre-upgrade backup uses this independently observed original runtime and
        licensed bundle.
      </p>
      <dl className="component-list">
        <div>
          <dt>Installed XenForo</dt>
          <dd>{baseline.proof.runtime.xenforoVersion}</dd>
        </div>
        <div>
          <dt>Original runtime</dt>
          <dd className="mono">{baseline.proof.runtimeImage}</dd>
        </div>
        <div>
          <dt>Original bundle</dt>
          <dd className="mono">{baseline.bundle.digest}</dd>
        </div>
        <div>
          <dt>Completed release Job</dt>
          <dd className="mono">{baseline.proof.releaseJob.uid}</dd>
        </div>
      </dl>
    </section>
  );
}
