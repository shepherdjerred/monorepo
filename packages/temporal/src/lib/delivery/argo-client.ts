import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";

/** Shared by Activities and independent native Jobs; credentials never enter request evidence. */
export async function argoApplicationRequest(
  path: string,
  body?: unknown,
  cancellation?: AbortSignal,
): Promise<unknown> {
  const base = Bun.env["ARGOCD_SERVER_URL"];
  const token = Bun.env["ARGOCD_TOKEN"];
  if (base === undefined || token === undefined)
    throw new Error("Delivery Argo credentials/bootstrap are missing");
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(
    new URL(`api/v1/applications/${path}`, `${base.replace(/\/$/u, "")}/`),
    {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal:
        cancellation === undefined
          ? timeout
          : AbortSignal.any([cancellation, timeout]),
    },
  );
  if (!response.ok)
    throw new Error(`Argo API returned HTTP ${response.status.toString()}`);
  return await response.json();
}
/** Ownership marker Delivery writes into every Application body it manages. */
export const DELIVERY_ENVIRONMENT_ANNOTATION =
  "delivery.shepherdjerred.com/environment";

export type ArgoTransport = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;
export type ArgoClientOptions = {
  fetch?: ArgoTransport;
  signal?: AbortSignal;
};

const OwnedApplicationSchema = z
  .object({
    metadata: z
      .object({
        name: z.string().min(1),
        resourceVersion: z.string().min(1),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
    spec: z.object({ source: z.unknown().optional() }).loose(),
  })
  .loose();
type OwnedApplication = z.infer<typeof OwnedApplicationSchema>;

function bootstrap() {
  const base = Bun.env["ARGOCD_SERVER_URL"];
  const token = Bun.env["ARGOCD_TOKEN"];
  if (base === undefined || token === undefined)
    throw new Error("Delivery Argo credentials/bootstrap are missing");
  return { base: `${base.replace(/\/$/u, "")}/`, token };
}

async function argoFetch(
  path: string,
  init: { method: string; body?: unknown; query?: Record<string, string> },
  options: ArgoClientOptions,
): Promise<Response> {
  const { base, token } = bootstrap();
  const url = new URL(`api/v1/applications${path}`, base);
  for (const [key, value] of Object.entries(init.query ?? {}))
    url.searchParams.set(key, value);
  const timeout = AbortSignal.timeout(30_000);
  return await (options.fetch ?? fetch)(url, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal:
      options.signal === undefined
        ? timeout
        : AbortSignal.any([options.signal, timeout]),
  });
}

function requireOwner(application: OwnedApplication, environmentId: string) {
  const owner =
    application.metadata.annotations?.[DELIVERY_ENVIRONMENT_ANNOTATION];
  if (owner !== environmentId)
    throw new Error(
      `Application ${application.metadata.name} is not owned by Delivery environment ${environmentId}`,
    );
}

/** Null when the Application does not exist; any other failure is thrown. */
export async function getArgoApplication(
  name: string,
  options: ArgoClientOptions = {},
): Promise<unknown> {
  const response = await argoFetch(
    `/${encodeURIComponent(name)}`,
    { method: "GET" },
    options,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Argo API returned HTTP ${response.status.toString()}`);
  return await response.json();
}

/** Creates from the recipe's full body; an existing object is a conflict, never an upsert. */
export async function createArgoApplication(
  body: unknown,
  options: ArgoClientOptions = {},
): Promise<unknown> {
  const application = OwnedApplicationSchema.omit({ metadata: true })
    .extend({
      metadata: z
        .object({
          name: z.string().min(1),
          annotations: z.record(z.string(), z.string()),
        })
        .loose(),
    })
    .parse(body);
  if (
    application.metadata.annotations[DELIVERY_ENVIRONMENT_ANNOTATION] ===
    undefined
  )
    throw new Error(
      "Delivery creates only Applications that carry its environment ownership annotation",
    );
  const response = await argoFetch(
    "",
    { method: "POST", body: application, query: { upsert: "false" } },
    options,
  );
  if (response.status === 409)
    throw new Error(
      `Application ${application.metadata.name} already exists; update it instead of creating`,
    );
  if (!response.ok)
    throw new Error(`Argo API returned HTTP ${response.status.toString()}`);
  return await response.json();
}

/**
 * Full-body replacement guarded by the body's resourceVersion (CAS) and by
 * Delivery's ownership annotation on the current object.
 */
export async function updateArgoApplication(
  name: string,
  body: unknown,
  input: { environmentId: string },
  options: ArgoClientOptions = {},
): Promise<unknown> {
  const desired = OwnedApplicationSchema.parse(body);
  if (desired.metadata.name !== name)
    throw new Error("Application body names another Application");
  const current = await getArgoApplication(name, options);
  if (current === null)
    throw new Error(`Application ${name} does not exist; create it first`);
  const observed = OwnedApplicationSchema.parse(current);
  requireOwner(observed, input.environmentId);
  if (
    desired.metadata.annotations?.[DELIVERY_ENVIRONMENT_ANNOTATION] !==
    input.environmentId
  )
    throw new Error(
      "Updated Application body must keep Delivery's environment ownership annotation",
    );
  if (observed.metadata.resourceVersion !== desired.metadata.resourceVersion)
    throw new Error(
      `Application ${name} changed since it was read (resourceVersion ${observed.metadata.resourceVersion}); re-read before updating`,
    );
  const response = await argoFetch(
    `/${encodeURIComponent(name)}`,
    { method: "PUT", body: desired },
    options,
  );
  if (response.status === 409)
    throw new Error(
      `Application ${name} changed concurrently; re-read before updating`,
    );
  if (!response.ok)
    throw new Error(`Argo API returned HTTP ${response.status.toString()}`);
  return await response.json();
}

/** Deletion follows the recipe's lifecycle policy: cascade removes resources, orphan retains them. */
export async function deleteArgoApplication(
  name: string,
  input: { environmentId: string; cascade: boolean },
  options: ArgoClientOptions = {},
): Promise<{ deleted: boolean }> {
  const current = await getArgoApplication(name, options);
  if (current === null) return { deleted: false };
  requireOwner(OwnedApplicationSchema.parse(current), input.environmentId);
  const response = await argoFetch(
    `/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      query: {
        cascade: input.cascade ? "true" : "false",
        propagationPolicy: input.cascade ? "foreground" : "orphan",
      },
    },
    options,
  );
  if (response.status === 404) return { deleted: false };
  if (!response.ok)
    throw new Error(`Argo API returned HTTP ${response.status.toString()}`);
  return { deleted: true };
}

/**
 * After acceptance the accepted exact source is re-asserted by ArgoCD's
 * self-heal with pruning disabled (T4). Refused unless the live source is
 * byte-identical to the expected one and the object is Delivery-owned.
 */
export async function setArgoSelfHeal(
  name: string,
  input: { environmentId: string; expectedSource: unknown },
  options: ArgoClientOptions = {},
): Promise<{ resourceVersion: string }> {
  const current = await getArgoApplication(name, options);
  if (current === null)
    throw new Error(`Application ${name} does not exist; nothing to self-heal`);
  const observed = OwnedApplicationSchema.parse(current);
  requireOwner(observed, input.environmentId);
  if (
    canonicalJson(observed.spec.source) !== canonicalJson(input.expectedSource)
  )
    throw new Error(
      `Application ${name} source differs from the accepted exact source; self-heal refused`,
    );
  const syncPolicy = z
    .object({ syncPolicy: z.record(z.string(), z.unknown()).optional() })
    .loose()
    .parse(observed.spec).syncPolicy;
  const patch = [
    {
      op: "test",
      path: "/metadata/resourceVersion",
      value: observed.metadata.resourceVersion,
    },
    {
      op: "test",
      path: `/metadata/annotations/${DELIVERY_ENVIRONMENT_ANNOTATION.replaceAll("/", "~1")}`,
      value: input.environmentId,
    },
    syncPolicy === undefined
      ? {
          op: "add",
          path: "/spec/syncPolicy",
          value: {
            automated: { enabled: true, selfHeal: true, prune: false },
          },
        }
      : {
          op: "add",
          path: "/spec/syncPolicy/automated",
          value: { enabled: true, selfHeal: true, prune: false },
        },
  ];
  const response = await argoFetch(
    `/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      body: { patch: JSON.stringify(patch), patchType: "json" },
    },
    options,
  );
  if (response.status === 409)
    throw new Error(
      `Application ${name} changed concurrently; re-read before enabling self-heal`,
    );
  if (!response.ok)
    throw new Error(`Argo API returned HTTP ${response.status.toString()}`);
  const updated = OwnedApplicationSchema.parse(await response.json());
  return { resourceVersion: updated.metadata.resourceVersion };
}
