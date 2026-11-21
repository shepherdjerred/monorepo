import { useId, useState, type ReactNode, type SubmitEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Deployment } from "#shared/contract.ts";
import { DeliveryClientError } from "#shared/client.ts";
import type { CreateDeploymentV2Request } from "#shared/model/routes-client.ts";
import type { EnvironmentDetail } from "#shared/hub/hub-contract.ts";
import { delivery } from "./api.ts";
import { queries } from "./queries.ts";
import { ErrorNotice } from "#client/components/notices.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import { revisionLabel } from "#client/components/identifier.tsx";
import { useNow } from "#client/components/time.tsx";
import {
  versionOptionLabel,
  type Blocker,
} from "#client/model/environment-status.ts";
import {
  BlockedReason,
  RequestError,
} from "#client/model/environment-notices.tsx";

type Kind = "deploy" | "promote";
const KindSchema = z.enum(["deploy", "promote"]);

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
        <>
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
              </li>
            ))}
          </ul>
          <Disclosure summary="Digests" count={diff.data.length}>
            <ul className="diff-digests">
              {diff.data.map((change) => (
                <li key={change.component}>
                  <strong>{change.component}</strong>
                  <small className="mono">
                    {change.after?.digest ?? change.before?.digest}
                  </small>
                </li>
              ))}
            </ul>
          </Disclosure>
        </>
      )}
    </div>
  );
}

/** What a request for a set revision does under the recipe the release freezes (section 5). */
const REALISING = {
  deploy: {
    option: "Deploy a version",
    note: null,
  },
  "channel-publish": {
    option: "Publish a version to the channel",
    note: "A channel recipe publishes the set revision; nothing is deployed to a cluster.",
  },
  "operator-run": {
    option: "Run a version with the operator tool",
    note: "An attested operator tool runs this recipe outside the cluster; Delivery records its intent and the stages the tool attests.",
  },
} as const;

/** The server's refusal of a set revision an ordinary deploy may not select (H4). */
const NOT_ELIGIBLE = "Set revision is not eligible";

/** An alarm on the accepted release, beside the button that would replace it. */
function MonitorHold({ environmentId }: { environmentId: string }) {
  const monitor = useQuery(queries.monitor(environmentId));
  const status = monitor.data;
  if (status?.state !== "alarmed") return null;
  return (
    <p className="notice">
      An alarm fired on the accepted release
      {status.policy === "hold"
        ? " and the environment is held for an operator"
        : ""}
      . Check the <a href="#monitor-heading">Monitor</a> before requesting
      another release.
    </p>
  );
}

/** The version a deploy names, or why there is none to name yet. */
function VersionField({
  detail,
  value,
  onChange,
  invalid,
  errorId,
  emptyId,
}: {
  detail: EnvironmentDetail;
  value: string;
  onChange: (versionId: string) => void;
  invalid: boolean;
  errorId: string;
  emptyId: string;
}) {
  const now = useNow();
  if (detail.versionSets.length === 0)
    return (
      <p className="input-readonly" id={emptyId}>
        No version of {detail.service.title} has been published yet. One appears
        here once{" "}
        <Link
          to="/pipelines/$serviceId"
          params={{ serviceId: detail.service.id }}
        >
          its pipeline
        </Link>{" "}
        builds and qualifies it.
      </p>
    );
  return (
    <label>
      Version set
      <select
        name="version"
        value={value}
        required
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">Choose a version set</option>
        {detail.versionSets.map((version) => (
          <option key={version.id} value={version.id}>
            {versionOptionLabel(version, now)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Why the selected set revision may need an override approval: the server
 * refused it, or it is not the release the promotion source accepted. Null
 * while an ordinary deploy can take it.
 */
function overrideReason(
  detail: EnvironmentDetail,
  versionId: string,
  refused: Readonly<Record<string, string>>,
) {
  if (versionId === "") return null;
  const server = refused[versionId];
  if (server !== undefined) return server;
  const source = detail.sourceEnvironment;
  return source === null || source.acceptedVersionSetRevisionId === versionId
    ? null
    : `${source.id} has not accepted this version, so an ordinary deploy refuses it.`;
}

function initialKindFor(
  initialKind: Kind | undefined,
  promotable: string | null,
  noop: boolean,
): Kind {
  if (promotable === null) return "deploy";
  return initialKind ?? (noop ? "deploy" : "promote");
}

/** Why the request cannot be made, or null when it can. */
function unavailable({
  permitted,
  blocker,
  planWaiting,
  kind,
  noop,
}: {
  permitted: boolean;
  blocker: Blocker | null;
  planWaiting: boolean;
  kind: Kind;
  noop: string | null;
}): ReactNode {
  if (!permitted) return "Your identity has read-only access.";
  if (blocker !== null)
    return <BlockedReason blocker={blocker} planWaiting={planWaiting} />;
  return kind === "promote" ? noop : null;
}

/**
 * Send a request and open the deployment it creates. A conflict refreshes
 * the environment, so the form names what is in the way; a set revision the
 * server refuses as not eligible is remembered, so the form offers the
 * override for it.
 */
function useReleaseRequest(
  environmentId: string,
  onRequested: (deployment: Deployment) => Promise<void>,
) {
  const [refused, setRefused] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const request = useMutation({
    mutationFn: async (input: CreateDeploymentV2Request) => {
      await onRequested(await delivery.createDeployment(input));
    },
    onError: async (error, input) => {
      if (!(error instanceof DeliveryClientError)) return;
      if (error.code === "CONFLICT")
        await queryClient.invalidateQueries({
          queryKey: queries.environment(environmentId).queryKey,
        });
      const refusedId =
        "versionSetRevisionId" in input ? input.versionSetRevisionId : null;
      if (
        typeof refusedId === "string" &&
        error.message.startsWith(NOT_ELIGIBLE)
      )
        setRefused((previous) => ({ ...previous, [refusedId]: error.message }));
    },
  });
  return { request, refused };
}

/** The override choice, with why it applies to the chosen version. */
function OverrideChoice({
  why,
  checked,
  onChange,
}: {
  why: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const reason = useId();
  return (
    <>
      <label className="checkbox">
        <input
          type="checkbox"
          name="override"
          checked={checked}
          aria-describedby={reason}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        Ask for an override approval
      </label>
      <p className="override-reason" id={reason}>
        {why} An override sends it to a human, who may admit it anyway.
      </p>
    </>
  );
}

/** What happens after the request, what to check first, and the button. */
function Footer({
  environment,
  disabled,
  pending,
  describedBy,
}: {
  environment: EnvironmentDetail["environment"];
  disabled: boolean;
  pending: boolean;
  describedBy: string | undefined;
}) {
  return (
    <div className="form-footer">
      <div className="release-notes">
        <p>
          {environment.approvalPolicy === "required"
            ? "This request will wait for a human approval."
            : "The pipeline will begin after its gates pass."}
        </p>
        <MonitorHold environmentId={environment.id} />
      </div>
      <button
        type="submit"
        className="primary-button"
        disabled={disabled}
        aria-disabled={pending ? true : undefined}
        aria-describedby={describedBy}
      >
        {pending ? "Submitting…" : "Request deployment"}
      </button>
    </div>
  );
}

/** The first text that says why the button is unavailable, or what refused it. */
function describedByFor(
  ids: { reason: string; empty: string; error: string },
  state: { reason: ReactNode; noVersions: boolean; error: unknown },
) {
  if (state.reason !== null) return ids.reason;
  if (state.noVersions) return ids.empty;
  return state.error === null ? undefined : ids.error;
}

/**
 * What a promotion would take: the source's accepted set revision, as its
 * revision number, and why promoting it changes nothing when this
 * environment already accepted it.
 */
function promotion(detail: EnvironmentDetail) {
  const source = detail.sourceEnvironment;
  const promotable = source?.acceptedVersionSetRevisionId ?? null;
  const label = (id: string) => {
    const version = detail.versionSets.find((entry) => entry.id === id);
    return version === undefined
      ? id.slice(0, 8)
      : revisionLabel(version.revision);
  };
  const noop =
    promotable !== null &&
    promotable === detail.environment.acceptedVersionSetRevisionId
      ? `${label(promotable)} is already accepted here, so promoting it from ${source?.id ?? "its source"} would change nothing.`
      : null;
  return { promotable, noop, label };
}

/** Request an exact release; the form is native and works with the keyboard. */
export function ReleaseForm({
  detail,
  permitted,
  blocker,
  planWaiting,
  initialKind,
  initialVersion = "",
  onRequested,
}: {
  detail: EnvironmentDetail;
  permitted: boolean;
  /** What stops this environment from taking a request now. */
  blocker: Blocker | null;
  planWaiting: boolean;
  initialKind: Kind | undefined;
  initialVersion?: string;
  onRequested: (deployment: Deployment) => Promise<void>;
}) {
  const { environment, sourceEnvironment } = detail;
  // The server reports the declared recipe's stored kind, as admission
  // reads it; the normalised kind would misread a v1 manual recipe.
  const realising = detail.releaseKind;
  const { promotable, noop, label } = promotion(detail);
  const [kind, setKind] = useState<Kind>(
    initialKindFor(initialKind, promotable, noop !== null),
  );
  const [versionId, setVersionId] = useState(initialVersion);
  const [override, setOverride] = useState(false);
  const ids = { error: useId(), reason: useId(), empty: useId() };
  const { request, refused } = useReleaseRequest(environment.id, onRequested);
  const deploying = kind === "deploy";
  const overrideWhy =
    deploying && realising === "deploy"
      ? overrideReason(detail, versionId, refused)
      : null;
  const reason = unavailable({ permitted, blocker, planWaiting, kind, noop });
  // With no version published, the field itself says so and links the pipeline.
  const noVersions = deploying && detail.versionSets.length === 0;
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason !== null || noVersions || request.isPending) return;
    const common = {
      requestId: crypto.randomUUID(),
      environmentId: environment.id,
      expectedGeneration: environment.generation,
    };
    // A promotion takes the source's accepted selection; it names no set revision (4.12).
    request.mutate(
      !deploying && sourceEnvironment !== null
        ? {
            ...common,
            kind: "promote",
            sourceEnvironmentId: sourceEnvironment.id,
          }
        : {
            ...common,
            kind: realising,
            versionSetRevisionId: versionId,
            // Only a plain deploy may ask for an override approval (H4).
            ...(overrideWhy !== null && override ? { override: true } : {}),
          },
    );
  }
  const selectedId = deploying ? versionId : (promotable ?? "");
  return (
    <section className="panel" aria-labelledby="release-heading">
      <h2 id="release-heading">Request a release</h2>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Action
            <select
              name="kind"
              value={kind}
              onChange={(event) => {
                setKind(KindSchema.parse(event.target.value));
                request.reset();
              }}
            >
              <option value="deploy">{REALISING[realising].option}</option>
              <option value="promote" disabled={promotable === null}>
                Promote accepted release
              </option>
            </select>
          </label>
          {deploying || promotable === null ? (
            <VersionField
              detail={detail}
              value={versionId}
              invalid={
                deploying &&
                request.error instanceof DeliveryClientError &&
                request.error.code === "INVALID"
              }
              errorId={ids.error}
              emptyId={ids.empty}
              onChange={(next) => {
                setVersionId(next);
                request.reset();
              }}
            />
          ) : (
            <p className="input-readonly">
              {label(promotable)} accepted in {sourceEnvironment?.id}
            </p>
          )}
        </div>
        {deploying && REALISING[realising].note !== null && (
          <p className="muted">{REALISING[realising].note}</p>
        )}
        {overrideWhy !== null && (
          <OverrideChoice
            why={overrideWhy}
            checked={override}
            onChange={setOverride}
          />
        )}
        {selectedId !== "" && (
          <ComponentDiff
            from={environment.desiredVersionSetRevisionId}
            to={selectedId}
          />
        )}
        {request.error !== null && (
          <RequestError
            id={ids.error}
            error={request.error}
            blocker={blocker}
            planWaiting={planWaiting}
          />
        )}
        <Footer
          environment={environment}
          disabled={reason !== null || noVersions}
          pending={request.isPending}
          describedBy={describedByFor(ids, {
            reason,
            noVersions,
            error: request.error,
          })}
        />
        {reason !== null && (
          <p className="notice" id={ids.reason}>
            {reason}
          </p>
        )}
      </form>
    </section>
  );
}
