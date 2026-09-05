/**
 * Session reads sit on the boundary between authentication and availability.
 * A successful `{ user: null }` response means signed out; a rejected request
 * only means the backend could not answer. In development the Bun watcher
 * briefly creates the latter state whenever it restarts the backend.
 */
export const SESSION_QUERY_OPTIONS = {
  retry: 10,
  retryDelay: 500,
  refetchInterval: (query: { state: { status: string } }) =>
    query.state.status === "error" ? 2000 : false,
};

export type SessionGuardState =
  "loading" | "authenticated" | "anonymous" | "unavailable";

/**
 * Classify a session query without turning transport errors into sign-outs.
 * Cached successful data remains authoritative during a failed background
 * refresh, so an already-rendered authenticated route stays mounted.
 */
export function resolveSessionGuardState(
  data: { user: object | null } | undefined,
  isError: boolean,
): SessionGuardState {
  if (data !== undefined) {
    return data.user === null ? "anonymous" : "authenticated";
  }
  return isError ? "unavailable" : "loading";
}
