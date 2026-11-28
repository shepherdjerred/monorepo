import type { Database } from "#infrastructure/database.ts";

/** Whether the service can do its work: true when the database answers. */
export type ReadyCheck = () => Promise<boolean>;

export function databaseReady(db: Database): ReadyCheck {
  return async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  };
}

export type ProbeKind = "healthz" | "readyz";

/**
 * The probe a request asks for, or null. Probes are answered on every host
 * before any login or CSRF check, so a tagged node or an ingress blackbox
 * probe needs no identity. They carry no data and no tokens.
 */
export function probeKind(method: string, path: string): ProbeKind | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (path === "/healthz") return "healthz";
  return path === "/readyz" ? "readyz" : null;
}

export async function probeAnswer(
  kind: ProbeKind,
  ready: ReadyCheck,
): Promise<{ status: 200 | 503; body: { status: "ok" | "unavailable" } }> {
  const ok = kind === "healthz" || (await ready());
  return ok
    ? { status: 200, body: { status: "ok" } }
    : { status: 503, body: { status: "unavailable" } };
}
