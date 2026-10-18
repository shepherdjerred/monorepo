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
