import { z } from "zod";
import {
  buildCookieHeader,
  findCsrfToken,
  loadMonarchSession,
} from "./session.ts";

const GQL_ENDPOINT = "https://api.monarch.com/graphql";
const APP_ORIGIN = "https://app.monarch.com";
const DEFAULT_CLIENT_VERSION = "2025.05";
const DEFAULT_GQL_TIMEOUT_MS = 30_000;

const GraphQlErrorSchema = z.looseObject({
  message: z.string().optional(),
});

function graphqlResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    data: dataSchema.optional(),
    errors: z.array(GraphQlErrorSchema).optional(),
  });
}

function formatGraphQlErrors(errors: z.infer<typeof GraphQlErrorSchema>[]) {
  return errors
    .map((error) => error.message ?? JSON.stringify(error))
    .join("; ");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function gqlRequest<T extends z.ZodType>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  dataSchema: T,
): Promise<z.infer<T>> {
  const session = await loadMonarchSession();
  const csrfToken = findCsrfToken(session);
  const cookie = buildCookieHeader(session.cookies);
  if (cookie === "") {
    throw new Error(
      'Saved Monarch session has no valid cookies. Run "bun run login" again.',
    );
  }

  const client = session.headers["monarch-client"] ?? "web";
  const clientVersion =
    session.headers["monarch-client-version"] ?? DEFAULT_CLIENT_VERSION;
  const userAgent = session.headers["user-agent"];

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: session.headers["origin"] ?? APP_ORIGIN,
    Referer: session.headers["referer"] ?? `${APP_ORIGIN}/`,
    "X-Csrftoken": csrfToken,
    "monarch-client": client,
    "monarch-client-version": clientVersion,
  };

  if (userAgent !== undefined && userAgent !== "") {
    headers["User-Agent"] = userAgent;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DEFAULT_GQL_TIMEOUT_MS);

  let response: Response;
  let text: string;
  try {
    response = await fetch(GQL_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ operationName, query, variables }),
    });
    text = await response.text();
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw new Error(
        `Monarch GraphQL ${operationName} timed out after ${String(DEFAULT_GQL_TIMEOUT_MS)}ms`,
        { cause: error },
      );
    }
    if (error instanceof Error) throw error;
    throw new Error(String(error), { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(
      `Monarch GraphQL ${operationName} failed: HTTP ${String(response.status)} ${response.statusText}: ${text}`,
    );
  }

  const raw: unknown = text === "" ? {} : JSON.parse(text);
  const parsed = graphqlResponseSchema(dataSchema).parse(raw);
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    throw new Error(
      `Monarch GraphQL ${operationName} failed: ${formatGraphQlErrors(parsed.errors)}`,
    );
  }
  if (parsed.data === undefined) {
    throw new Error(`Monarch GraphQL ${operationName} returned no data`);
  }
  return parsed.data;
}
