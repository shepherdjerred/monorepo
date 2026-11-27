/**
 * The whole service in process, for other packages' contract tests (the
 * `toolkit artifacts` suite). Test-only: nothing in `src/server` imports it.
 *
 * It boots the app host (tRPC, `/api/uploads`, both SSE streams) over a
 * freshly migrated test PostgreSQL database and an in-memory object store.
 * Requests are dispatched in process, so server-sent events stream through
 * `fetchAsAgent` and `fetchAsHuman` like any other response.
 */
import { createMigratedDatabase } from "./database.ts";
import { APP_ORIGIN, LOGIN, hostHeader, createTestRuntime } from "./runtime.ts";

export type InProcessService = {
  /** The app host origin the service believes it has. */
  baseUrl: string;
  /**
   * The CLI path: adds the operator's Tailscale login and nothing else, so the
   * caller supplies `X-Artifacts-Actor` and sends no `Origin`.
   */
  fetchAsAgent: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /** The browser path: login, `Origin` and `Sec-Fetch-Site: same-origin`. */
  fetchAsHuman: (input: string | URL, init?: RequestInit) => Promise<Response>;
  stop: () => Promise<void>;
};

export async function startInProcessService(
  options: { settleMs?: number } = {},
): Promise<InProcessService> {
  const database = await createMigratedDatabase();
  const runtime = await createTestRuntime({
    db: database.db,
    databaseUrl: database.url,
    flagValues: {
      "artifacts-feedback-settle-seconds": (options.settleMs ?? 100) / 1000,
    },
  });
  const dispatch = (
    input: string | URL,
    init: RequestInit | undefined,
    extra: Record<string, string>,
  ) => {
    const url = new URL(input, APP_ORIGIN);
    const headers = new Headers(init?.headers);
    headers.set("host", hostHeader("app"));
    headers.set("Tailscale-User-Login", LOGIN);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    return Promise.resolve(
      runtime.fetch(new Request(url, { ...init, headers })),
    );
  };
  return {
    baseUrl: APP_ORIGIN,
    fetchAsAgent: (input, init) => dispatch(input, init, {}),
    fetchAsHuman: (input, init) =>
      dispatch(input, init, {
        Origin: APP_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      }),
    stop: async () => {
      await runtime.hub.stop();
      await database.close();
    },
  };
}
