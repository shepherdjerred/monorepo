import {
  isVerifiedRootReleaseTermination,
  RootReleaseApplicationSchema,
  VERIFIED_ROOT_RELEASE_ANNOTATION,
  VerifiedRootReleaseReceiptSchema,
} from "@shepherdjerred/ops-model/argocd-release-receipt.ts";

/** Called only after release-root independently verifies apply, policies and health. */
export function verifiedRootReleasePatch(
  input: unknown,
  requestId: string,
  revision: string,
  verifiedAt: string,
) {
  const app = RootReleaseApplicationSchema.parse(input);
  const state = app.status.operationState;
  const operationIds =
    state?.operation?.info?.filter(
      (entry) => entry.name === "ci.sjer.red/operation-id",
    ) ?? [];
  const receipt = VerifiedRootReleaseReceiptSchema.parse({
    schema: "homelab-verified-root-release/v1",
    outcome: "applied-verified",
    rootApplication: "apps",
    requestId,
    operationId: operationIds.length === 1 ? operationIds[0]?.value : undefined,
    revision,
    operationStartedAt: state?.startedAt,
    operationFinishedAt: state?.finishedAt,
    verifiedAt,
    finalHealth:
      "published-applications-synced-healthy-retained-applications-observed",
  });
  const encoded = JSON.stringify(receipt);
  const annotated = {
    ...app,
    metadata: {
      ...app.metadata,
      annotations: {
        ...app.metadata.annotations,
        [VERIFIED_ROOT_RELEASE_ANNOTATION]: encoded,
      },
    },
  };
  if (!isVerifiedRootReleaseTermination(annotated)) {
    throw new Error(
      "Verified release receipt does not match the owned root prune termination",
    );
  }
  if (app.metadata.resourceVersion === undefined)
    throw new Error(
      "Root release has no resourceVersion for receipt publication",
    );
  return {
    receipt,
    patch: [
      {
        op: "test",
        path: "/metadata/resourceVersion",
        value: app.metadata.resourceVersion,
      },
      ...(app.metadata.annotations === undefined
        ? [{ op: "add", path: "/metadata/annotations", value: {} }]
        : []),
      {
        op: "add",
        path: `/metadata/annotations/${VERIFIED_ROOT_RELEASE_ANNOTATION.replaceAll("/", "~1")}`,
        value: encoded,
      },
    ],
  };
}

export async function publishVerifiedRootReleaseReceipt(options: {
  application: unknown;
  requestId: string;
  revision: string;
  serverUrl: string;
  token: string;
  fetcher?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}): Promise<void> {
  const app = RootReleaseApplicationSchema.parse(options.application);
  // Naturally completed operations need no termination exemption.
  if (app.status.operationState?.phase === "Succeeded") return;
  const { patch, receipt } = verifiedRootReleasePatch(
    options.application,
    options.requestId,
    options.revision,
    new Date().toISOString(),
  );
  const response = await (options.fetcher ?? fetch)(
    `${options.serverUrl}/api/v1/applications/apps`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "apps",
        patchType: "json",
        patch: JSON.stringify(patch),
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Verified root release receipt publication failed: HTTP ${response.status.toString()}`,
    );
  const confirmed: unknown = await response.json();
  const observed = RootReleaseApplicationSchema.parse(confirmed);
  if (
    !isVerifiedRootReleaseTermination(observed) ||
    observed.metadata.annotations?.[VERIFIED_ROOT_RELEASE_ANNOTATION] !==
      JSON.stringify(receipt)
  )
    throw new Error(
      "Published root release receipt failed read-back verification",
    );
}
