import type { PlatformReleaseSnapshot } from "#shared/contract.ts";

export function FrozenPlatform({
  snapshot,
}: {
  snapshot: PlatformReleaseSnapshot;
}) {
  return (
    <section aria-label="Frozen platform release">
      <h3>
        {snapshot.kind === "root-release"
          ? "Exact root chart inventory"
          : snapshot.kind === "tofu-plan"
            ? "Read-only OpenTofu plan"
            : "Exact saved OpenTofu plan"}
      </h3>
      <p className="notice">
        {snapshot.kind === "tofu-plan"
          ? "Planning changes no infrastructure and does not accept an application release."
          : "Infrastructure acceptance is recorded separately from application versions."}
      </p>
      <dl className="component-list">
        <div>
          <dt>Original source build</dt>
          <dd className="mono">
            {snapshot.source.id}
            <small>{snapshot.source.sourceRevision}</small>
            <small>
              Repository {snapshot.source.repositoryId} · pipeline{" "}
              {snapshot.source.pipelineNumber}
            </small>
          </dd>
        </div>
        {snapshot.kind !== "root-release" && (
          <div>
            <dt>State stack</dt>
            <dd>{snapshot.stack}</dd>
          </div>
        )}
        {snapshot.kind === "tofu-apply" && (
          <>
            <div>
              <dt>Saved plan digest</dt>
              <dd className="mono">
                {snapshot.plan.planDigest}
                <small>Plan deployment {snapshot.planDeploymentId}</small>
              </dd>
            </div>
            <div>
              <dt>State identity</dt>
              <dd className="mono">
                {snapshot.plan.state.lineage}
                <small>Serial {snapshot.plan.state.serial}</small>
              </dd>
            </div>
            <div>
              <dt>Plan changes</dt>
              <dd>
                Create {snapshot.plan.changes.create} · update{" "}
                {snapshot.plan.changes.update} · delete{" "}
                {snapshot.plan.changes.delete} · replace{" "}
                {snapshot.plan.changes.replace}
              </dd>
            </div>
            <div>
              <dt>Plan expiry</dt>
              <dd>{snapshot.plan.expiresAt}</dd>
            </div>
            <div>
              <dt>Original plan Job</dt>
              <dd className="mono">
                {snapshot.plan.nativeJob.name}
                <small>UID {snapshot.plan.nativeJob.uid}</small>
                <small>
                  Fingerprint {snapshot.plan.nativeJob.specFingerprint}
                </small>
              </dd>
            </div>
          </>
        )}
      </dl>
      {snapshot.kind === "root-release" && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Chart</th>
                <th>Original artifact</th>
                <th>Exact bytes and source</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.charts.map(({ name, artifact }) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="mono">
                    {artifact.id}
                    <small>Build {artifact.buildId}</small>
                  </td>
                  <td className="mono">
                    {artifact.digest}
                    <small>{artifact.sourceRevision}</small>
                    <small>{artifact.uri}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {snapshot.prerequisites.length > 0 && (
        <details>
          <summary>Exact prerequisites</summary>
          <ul>
            {snapshot.prerequisites.map((entry, index) => (
              <li key={index} className="mono">
                {entry.kind === "site"
                  ? `${entry.environmentId} accepts ${entry.artifactId}`
                  : entry.kind === "tofu"
                    ? `${entry.stack} accepts source ${entry.sourceBuildId}`
                    : `Root accepts source ${entry.sourceBuildId}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
