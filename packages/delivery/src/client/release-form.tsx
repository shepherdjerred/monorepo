import { useState, type SubmitEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CreateDeployment,
  Environment,
  Overview,
} from "#shared/contract.ts";
import type { createDeliveryClient } from "#shared/client.ts";
import { versionLabel } from "./presentation.ts";
import { ErrorNotice } from "./components.tsx";

export type DeliveryClient = ReturnType<typeof createDeliveryClient>;

export function ReleaseForm({
  environment,
  overview,
  client,
  permitted,
  pending,
  onSubmit,
  onClose,
}: {
  environment: Environment;
  overview: Overview;
  client: DeliveryClient;
  permitted: boolean;
  pending: boolean;
  onSubmit: (input: CreateDeployment) => void;
  onClose: () => void;
}) {
  const versions = overview.versionSets.filter(
    (version) => version.serviceId === environment.serviceId,
  );
  const [versionId, setVersionId] = useState("");
  const [kind, setKind] = useState<CreateDeployment["kind"]>("deploy");
  const source = overview.environments.find(
    (candidate) => candidate.id === environment.promotionSourceEnvironmentId,
  );
  const selectedId =
    kind === "promote"
      ? (source?.acceptedVersionSetRevisionId ?? "")
      : versionId;
  const diff = useQuery({
    queryKey: ["diff", environment.desiredVersionSetRevisionId, selectedId],
    queryFn: () =>
      client.diff(environment.desiredVersionSetRevisionId, selectedId),
    enabled: selectedId !== "",
  });
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!permitted || selectedId === "") return;
    onSubmit({
      requestId: crypto.randomUUID(),
      environmentId: environment.id,
      versionSetRevisionId: selectedId,
      expectedGeneration: environment.generation,
      kind,
      ...(kind === "promote" && source !== undefined
        ? { sourceEnvironmentId: source.id }
        : {}),
    });
  }
  return (
    <section className="panel release-panel" aria-labelledby="release-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Select an immutable release</p>
          <h2 id="release-heading">{environment.id}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close release selection"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Action
            <select
              value={kind}
              onChange={(event) => {
                const value = event.target.value;
                if (
                  value === "deploy" ||
                  value === "promote" ||
                  value === "rollback"
                )
                  setKind(value);
              }}
            >
              <option value="deploy">Deploy a version</option>
              <option
                value="promote"
                disabled={source?.acceptedVersionSetRevisionId == null}
              >
                Promote accepted release
              </option>
              <option value="rollback">Rollback to a version</option>
            </select>
          </label>
          <label>
            Version set
            {kind === "promote" ? (
              <div className="input-readonly">
                {versionLabel(selectedId || null, overview.versionSets)} from{" "}
                {source?.id}
              </div>
            ) : (
              <select
                value={versionId}
                onChange={(event) => {
                  setVersionId(event.target.value);
                }}
                required
              >
                <option value="">Choose a version set</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.serviceId} @ {version.revision} · {version.id}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
        {selectedId !== "" && <ComponentDiff query={diff} />}
        <div className="form-footer">
          <p>
            {environment.approvalRequired
              ? "This request will wait for a human approval."
              : "The pipeline will begin after its gates pass."}{" "}
            {kind === "rollback" &&
              "Data restoration remains a separate recovery operation."}
          </p>
          <button
            type="submit"
            className="primary-button"
            disabled={
              !permitted ||
              pending ||
              selectedId === "" ||
              diff.isPending ||
              diff.error !== null
            }
          >
            {pending ? "Submitting…" : "Request deployment"}
          </button>
        </div>
        {!permitted && (
          <p className="notice">Your identity has read-only access.</p>
        )}
      </form>
    </section>
  );
}

function ComponentDiff({
  query,
}: {
  query: ReturnType<
    typeof useQuery<Awaited<ReturnType<DeliveryClient["diff"]>>>
  >;
}) {
  if (query.isPending) return <p>Loading comparison…</p>;
  if (query.error !== null) return <ErrorNotice error={query.error} />;
  return (
    <div className="diff">
      <h3>Component changes</h3>
      {query.data.length === 0 ? (
        <p>No artifact changes.</p>
      ) : (
        <ul>
          {query.data.map((change) => (
            <li key={change.component}>
              <strong>{change.component}</strong>
              <span className="mono">
                {change.before?.version ?? "Absent"}{" "}
                <span aria-hidden="true">→</span>{" "}
                {change.after?.version ?? "Removed"}
              </span>
              <small className="mono">
                {change.after?.digest ?? change.before?.digest}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
