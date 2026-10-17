import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  deliverySelectionPatch,
  assertDeliveryRootPreservesSelection,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";

export async function argoRequest(
  path: string,
  body?: unknown,
): Promise<unknown> {
  const base = Bun.env["ARGOCD_SERVER_URL"];
  const token = Bun.env["ARGOCD_TOKEN"];
  if (base === undefined || token === undefined)
    throw new Error("Delivery Argo credentials/bootstrap are missing");
  const response = await fetch(
    new URL(`api/v1/applications/${path}`, `${base.replace(/\/$/u, "")}/`),
    {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([
        Context.current().cancellationSignal,
        AbortSignal.timeout(30_000),
      ]),
    },
  );
  if (!response.ok)
    throw new Error(`Argo API returned HTTP ${response.status.toString()}`);
  return await response.json();
}

export async function selectArgoRelease(selection: DeliverySelection) {
  assertDeliveryRootPreservesSelection(await argoRequest("apps"));
  const path = encodeURIComponent(selection.application);
  const current = await argoRequest(path);
  const patch = deliverySelectionPatch(current, selection);
  await argoRequest(path, { patch: JSON.stringify(patch), patchType: "json" });
}

/** Existing CLI retains immutable-field and exact operation ownership checks. */
export async function syncArgoRelease(
  selection: DeliverySelection,
  operationId: string,
) {
  const context = Context.current();
  const bundled = new URL("../../../dist/delivery-argocd.js", import.meta.url)
    .pathname;
  const command =
    Bun.env["ENVIRONMENT"] === "production"
      ? bundled
      : new URL("../../../../homelab/scripts/argocd/argocd.ts", import.meta.url)
          .pathname;
  if (!(await Bun.file(command).exists()))
    throw new Error(
      "Required guarded Argo command is missing from the worker image",
    );
  const process = Bun.spawn(
    [
      "bun",
      command,
      "sync-managed",
      selection.application,
      "--revision",
      selection.revision,
      "--request-id",
      operationId,
      "--timeout",
      "1200",
    ],
    {
      cwd: new URL("../../../../../", import.meta.url).pathname,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: {
        PATH: Bun.env["PATH"],
        ARGOCD_SERVER_URL: Bun.env["ARGOCD_SERVER_URL"],
        ARGOCD_TOKEN: Bun.env["ARGOCD_TOKEN"],
      },
    },
  );
  const cancel = () => {
    process.kill("SIGKILL");
  };
  context.cancellationSignal.addEventListener("abort", cancel, { once: true });
  const heartbeat = setInterval(() => {
    context.heartbeat({ operationId, application: selection.application });
  }, 10_000);
  try {
    if (context.cancellationSignal.aborted) cancel();
    if ((await process.exited) !== 0)
      throw new Error(
        "Guarded Argo synchronization failed; inspect the recorded request before retrying",
      );
  } finally {
    clearInterval(heartbeat);
    context.cancellationSignal.removeEventListener("abort", cancel);
  }
}

const SourceSchema = z.object({
  repoURL: z.string(),
  chart: z.string(),
  targetRevision: z.string(),
  helm: z
    .object({
      parameters: z
        .array(
          z.object({
            name: z.string(),
            value: z.string(),
            forceString: z.literal(true),
          }),
        )
        .optional(),
    })
    .optional(),
});
const ObservationSchema = z.object({
  operation: z.null().optional(),
  spec: z.object({ source: SourceSchema }),
  status: z.object({
    sync: z.object({ status: z.literal("Synced"), revision: z.string() }),
    health: z.object({ status: z.literal("Healthy") }),
    operationState: z.object({
      phase: z.literal("Succeeded"),
      finishedAt: z.iso.datetime({ offset: true }),
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
      syncResult: z.object({ revision: z.string() }),
    }),
    history: z
      .array(
        z.object({
          id: z.number(),
          revision: z.string(),
          source: SourceSchema,
        }),
      )
      .min(1),
  }),
});

export function verifyArgoRelease(
  input: unknown,
  selection: DeliverySelection,
  operationId: string,
) {
  const current = ObservationSchema.parse(input);
  const latest = current.status.history.reduce((left, right) =>
    left.id > right.id ? left : right,
  );
  const expectedParameters = Object.fromEntries(
    Object.entries(selection.parameters).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const sourceMatches = (source: z.infer<typeof SourceSchema>) =>
    source.repoURL === selection.repository &&
    source.chart === selection.chart &&
    source.targetRevision === selection.revision &&
    JSON.stringify(
      Object.fromEntries(
        (source.helm?.parameters ?? [])
          .map(({ name, value }): [string, string] => [name, value])
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    ) === JSON.stringify(expectedParameters);
  const requests = current.status.operationState.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  if (
    requests.length !== 1 ||
    requests[0]?.value !== operationId ||
    current.status.sync.revision !== selection.revision ||
    current.status.operationState.syncResult.revision !== selection.revision ||
    latest.revision !== selection.revision ||
    !sourceMatches(current.spec.source) ||
    !sourceMatches(latest.source)
  )
    throw new Error(
      "Argo observation does not prove the exact owned selected release",
    );
  const operationIds = current.status.operationState.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/operation-id",
  );
  if (operationIds.length !== 1)
    throw new Error("Argo operation receipt has no unique operation identity");
  return {
    requestId: operationId,
    operationId: z.uuid().parse(operationIds[0]?.value),
    revision: selection.revision,
  };
}
