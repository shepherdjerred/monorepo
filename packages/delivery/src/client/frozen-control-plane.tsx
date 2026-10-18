import type { ControlPlaneUpgradeSnapshot } from "#shared/contract.ts";

export function FrozenControlPlane({
  snapshot,
}: {
  snapshot: ControlPlaneUpgradeSnapshot;
}) {
  const selections = [
    { role: "Previous controller image", artifact: snapshot.previousArtifact },
    { role: "Selected controller image", artifact: snapshot.nextArtifact },
    {
      role: "Previous controller chart",
      artifact: snapshot.priorChartArtifact,
    },
    { role: "Selected controller chart", artifact: snapshot.chartArtifact },
  ];
  return (
    <section aria-label="Frozen control-plane upgrade">
      <h3>Independent control-plane upgrade</h3>
      <p className="notice">
        Existing operations drain before controller replacement. New execution
        waits until this operation or its independent recovery settles.
      </p>
      <p className="mono">
        Original chart source {snapshot.source.id}
        <small>{snapshot.source.sourceRevision}</small>
      </p>
      <p>
        {snapshot.priorSelectionManaged
          ? "Prior source includes the exact Helm image parameter."
          : "Prior source has no managed Helm image parameter."}{" "}
        Independent native verification must prove the frozen original selection
        before replacement.
      </p>
      <dl className="component-list">
        {selections.map(({ role, artifact }) => (
          <div key={role}>
            <dt>{role}</dt>
            <dd className="mono">
              {artifact.id}
              <small>{artifact.digest}</small>
              <small>
                Owner {artifact.serviceId} · build {artifact.buildId}
              </small>
              <small>{artifact.sourceRevision}</small>
              <small>{artifact.uri}</small>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
