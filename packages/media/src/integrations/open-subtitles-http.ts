import { z } from "zod";
import { IntegrationError, request, type FetchTransport } from "./http.ts";

const service = "opensubtitles";

export const OpenSubtitlesSessionSchema = z.object({
  token: z.string().min(1),
  base_url: z
    .enum(["api.opensubtitles.com", "vip-api.opensubtitles.com"])
    .default("api.opensubtitles.com"),
});

export async function requestOpenSubtitlesApi(
  transport: FetchTransport,
  url: URL,
  init: RequestInit & { mutation?: boolean },
): Promise<Response> {
  if (
    url.pathname !== "/api/v1/subtitles" ||
    (init.method !== undefined && init.method !== "GET")
  )
    return await request(transport, service, url, init);

  const deadline = AbortSignal.timeout(30_000);
  const signal =
    init.signal == null ? deadline : AbortSignal.any([deadline, init.signal]);
  const search = { ...init, signal };
  const response = await request(transport, service, url, {
    ...search,
    acceptedStatuses: [301],
  });
  if (response.status !== 301) return response;

  const location = response.headers.get("location");
  await response.body?.cancel();
  const target = location === null ? null : URL.parse(location, url);
  if (
    target?.origin !== url.origin ||
    target.pathname !== url.pathname ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  )
    throw new IntegrationError(service, "invalid-response", response.status);

  // The canonical redirect can re-encode the query, but cannot change its filters.
  const parameters = new URLSearchParams(target.search);
  parameters.sort();
  if (parameters.toString() !== url.searchParams.toString())
    throw new IntegrationError(service, "invalid-response", response.status);

  return await request(transport, service, target, search);
}
