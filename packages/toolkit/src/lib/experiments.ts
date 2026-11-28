import {
  EXPERIMENTS_API_PATH,
  ExperimentErrorSchema,
} from "@shepherdjerred/experiments/contract";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import type { z } from "zod";
import { optionalEnv } from "#lib/config.ts";
import { resolveCredentialValues } from "#lib/credentials.ts";

const MACHINE_TOKEN = "EXPERIMENTS_MACHINE_TOKEN";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type ExperimentsRequest = {
  readonly path?: string;
  readonly method: "GET" | "POST" | "PATCH";
  readonly query?: URLSearchParams;
  readonly body?: unknown;
  readonly requestId?: string;
};

function experimentsOrigin(override: string | undefined): string {
  const parsed = URL.parse(
    override ?? optionalEnv("EXPERIMENTS_URL") ?? APP_HOSTS.experiments,
  );
  if (
    parsed === null ||
    !(
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname))
    ) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "Experiments URL must be an HTTPS origin or an HTTP loopback origin without embedded credentials.",
    );
  }
  return parsed.origin;
}

async function machineToken(origin: string): Promise<string> {
  const configuredToken = optionalEnv(MACHINE_TOKEN);
  if (configuredToken !== undefined) return configuredToken;
  if (origin !== APP_HOSTS.experiments) {
    throw new Error(`Set ${MACHINE_TOKEN} for the custom Experiments origin.`);
  }
  const credentials = await resolveCredentialValues([MACHINE_TOKEN]);
  const token = credentials[MACHINE_TOKEN];
  if (token === undefined || token.length === 0) {
    throw new Error(`The credential broker returned no ${MACHINE_TOKEN}.`);
  }
  return token;
}

function apiError(
  status: number,
  payload: unknown,
  token: string,
  retry: string,
): Error {
  const parsed = ExperimentErrorSchema.safeParse(payload);
  const message = parsed.success
    ? parsed.data.error.replaceAll(token, "[redacted]").slice(0, 240)
    : "Unexpected response from the Experiments service";
  return new Error(
    `Experiments API request failed (${String(status)}). ${message}${status >= 500 ? retry : ""}`,
  );
}

export async function requestExperiments<T>(
  override: string | undefined,
  request: ExperimentsRequest,
  resultSchema: z.ZodType<T>,
): Promise<T> {
  const origin = experimentsOrigin(override);
  const url = new URL(`${EXPERIMENTS_API_PATH}${request.path ?? ""}`, origin);
  if (request.query !== undefined) url.search = request.query.toString();
  const token = await machineToken(origin);
  let headers: Headers;
  try {
    headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
  } catch {
    throw new Error(
      "The Experiments machine token is not a valid HTTP credential.",
    );
  }
  const body =
    request.body === undefined ? undefined : JSON.stringify(request.body);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const retry =
    request.requestId === undefined
      ? ""
      : ` Retry the same write with --request-id ${request.requestId}.`;
  let response: Response;
  let responseText: string;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    responseText = await response.text();
  } catch {
    throw new Error(
      `Could not reach the Experiments service at ${origin}.${retry}`,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    if (!response.ok) throw apiError(response.status, undefined, token, retry);
    throw new Error(`The Experiments service returned invalid JSON.${retry}`);
  }
  if (!response.ok) throw apiError(response.status, payload, token, retry);
  const parsed = resultSchema.safeParse(payload);
  if (!parsed.success)
    throw new Error(
      `The Experiments response did not match the API contract.${retry}`,
    );
  return parsed.data;
}
