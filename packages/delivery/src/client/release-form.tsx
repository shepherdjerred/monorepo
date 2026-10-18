import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { CreateDeployment, Deployment } from "#shared/contract.ts";
import type { EnvironmentDetail } from "#shared/hub/hub-contract.ts";
import { delivery } from "./api.ts";
import { ErrorNotice, errorMessage } from "#client/components/notices.tsx";

type Kind = "deploy" | "promote" | "rollback";
const KindSchema = z.enum(["deploy", "promote", "rollback"]);

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="primary-button"
      disabled={disabled || pending}
    >
      {pending ? "Submitting…" : "Request deployment"}
    </button>
  );
}

function ComponentDiff({ from, to }: { from: string | null; to: string }) {
  const diff = useQuery({
    queryKey: ["diff", from, to],
    queryFn: () => delivery.diff(from, to),
  });
  if (diff.isPending) return <p role="status">Loading comparison…</p>;
  if (diff.error !== null) return <ErrorNotice error={diff.error} />;
  return (
    <div className="diff">
      <h3>Component changes</h3>
      {diff.data.length === 0 ? (
        <p>No artifact changes.</p>
      ) : (
        <ul>
          {diff.data.map((change) => (
            <li key={change.component}>
              <strong>{change.component}</strong>
              <span className="mono">
                {change.before?.version ?? "Absent"}{" "}
                <span aria-hidden="true">→</span>
                <span className="visually-hidden"> to </span>{" "}
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

/** Request an exact release; the form is native and works with the keyboard. */
export function ReleaseForm({
  detail,
  permitted,
  initialKind,
  initialVersion = "",
  onRequested,
}: {
  detail: EnvironmentDetail;
  permitted: boolean;
  initialKind: Kind | undefined;
  initialVersion?: string;
  onRequested: (deployment: Deployment) => Promise<void>;
}) {
  const { environment, sourceEnvironment } = detail;
  const promotable = sourceEnvironment?.acceptedVersionSetRevisionId ?? null;
  const [kind, setKind] = useState<Kind>(
    initialKind === "promote" && promotable === null
      ? "deploy"
      : (initialKind ?? (promotable === null ? "deploy" : "promote")),
  );
  const [versionId, setVersionId] = useState(initialVersion);
  const selectedId = kind === "promote" ? (promotable ?? "") : versionId;
  const [state, submit] = useActionState(
    async (_previous: { error: string | null }, form: FormData) => {
      const action = KindSchema.parse(form.get("kind"));
      const chosen = form.get("version");
      const version =
        action === "promote"
          ? promotable
          : typeof chosen === "string"
            ? chosen
            : null;
      if (version === null || version === "")
        return { error: "Choose a version set" };
      const input: CreateDeployment = {
        requestId: crypto.randomUUID(),
        environmentId: environment.id,
        versionSetRevisionId: version,
        expectedGeneration: environment.generation,
        kind: action,
        ...(action === "promote" && sourceEnvironment !== null
          ? { sourceEnvironmentId: sourceEnvironment.id }
          : {}),
      };
      try {
        await onRequested(await delivery.createDeployment(input));
        return { error: null };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    { error: null },
  );
  const label = (id: string | null) =>
    detail.versionSets.find((version) => version.id === id)?.revision;
  return (
    <section className="panel release-panel" aria-labelledby="release-heading">
      <h2 id="release-heading">Request a release</h2>
      <form action={submit}>
        <div className="form-grid">
          <label>
            Action
            <select
              name="kind"
              value={kind}
              onChange={(event) => {
                setKind(KindSchema.parse(event.target.value));
              }}
            >
              <option value="deploy">Deploy a version</option>
              <option value="promote" disabled={promotable === null}>
                Promote accepted release
              </option>
              <option value="rollback">Rollback to a version</option>
            </select>
          </label>
          {kind === "promote" ? (
            <p className="input-readonly">
              r{label(promotable)} accepted in {sourceEnvironment?.id}
            </p>
          ) : (
            <label>
              Version set
              <select
                name="version"
                value={versionId}
                required
                onChange={(event) => {
                  setVersionId(event.target.value);
                }}
              >
                <option value="">Choose a version set</option>
                {detail.versionSets.map((version) => (
                  <option key={version.id} value={version.id}>
                    r{version.revision} · {version.id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {selectedId !== "" && (
          <ComponentDiff
            from={environment.desiredVersionSetRevisionId}
            to={selectedId}
          />
        )}
        {state.error !== null && (
          <p className="notice error" role="alert">
            {state.error}
          </p>
        )}
        <div className="form-footer">
          <p>
            {environment.approvalRequired
              ? "This request will wait for a human approval."
              : "The pipeline will begin after its gates pass."}{" "}
            {kind === "rollback" &&
              "Data restoration remains a separate recovery operation."}
          </p>
          <SubmitButton disabled={!permitted} />
        </div>
        {!permitted && (
          <p className="notice">Your identity has read-only access.</p>
        )}
      </form>
    </section>
  );
}
