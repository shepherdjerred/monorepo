export type FetchTransport = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

export type IntegrationFailure =
  | "authentication"
  | "rate-limited"
  | "unavailable"
  | "invalid-response"
  | "outcome-unknown"
  | "interaction-required"
  | "unsupported-target"
  | "conflict";

/** Deliberately excludes response bodies, credential-bearing URLs, and causes. */
export class IntegrationError extends Error {
  constructor(
    readonly service: string,
    readonly kind: IntegrationFailure,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`${service}: ${kind}`);
    this.name = "IntegrationError";
  }
}

export function endpoint(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    throw new Error("Invalid integration endpoint");
  }
  return new URL(
    `${base.pathname.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`,
    base.origin,
  );
}

export async function request(
  transport: FetchTransport,
  service: string,
  url: URL,
  init: RequestInit & {
    mutation?: boolean;
    acceptedStatuses?: readonly number[];
  },
): Promise<Response> {
  const deadline = AbortSignal.timeout(30_000);
  const signal =
    init.signal === undefined || init.signal === null
      ? deadline
      : AbortSignal.any([deadline, init.signal]);
  let response: Response;
  try {
    response = await transport(url, { ...init, signal, redirect: "manual" });
  } catch {
    throw new IntegrationError(
      service,
      init.mutation === true ? "outcome-unknown" : "unavailable",
    );
  }
  if (response.ok || init.acceptedStatuses?.includes(response.status) === true)
    return response;
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 412
  ) {
    throw new IntegrationError(service, "authentication", response.status);
  }
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const seconds =
      retry !== null && /^\d+$/u.test(retry) ? Number(retry) : undefined;
    throw new IntegrationError(
      service,
      "rate-limited",
      response.status,
      seconds,
    );
  }
  throw new IntegrationError(
    service,
    init.mutation === true ? "outcome-unknown" : "unavailable",
    response.status,
  );
}

export async function json(
  response: Response,
  service: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new IntegrationError(service, "invalid-response");
  }
}
