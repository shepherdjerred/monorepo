import path from "node:path";
import { z } from "zod";

const PACKAGE_ROOT = path.join(import.meta.dirname, "..", "..", "..");
const DEFAULT_SESSION_PATH = path.join(PACKAGE_ROOT, ".monarch-session.json");

const MonarchCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});

export const MonarchSessionSchema = z.object({
  createdAt: z.string(),
  cookies: z.array(MonarchCookieSchema),
  headers: z.record(z.string(), z.string()).default({}),
});

export type MonarchCookie = z.infer<typeof MonarchCookieSchema>;
export type MonarchSession = z.infer<typeof MonarchSessionSchema>;

export function getSessionPath(): string {
  const explicit = Bun.env["MONARCH_SESSION_PATH"];
  if (explicit !== undefined && explicit !== "") return explicit;
  return DEFAULT_SESSION_PATH;
}

export async function loadMonarchSession(): Promise<MonarchSession> {
  const sessionJson = Bun.env["MONARCH_SESSION_JSON"];
  if (sessionJson !== undefined && sessionJson !== "") {
    return MonarchSessionSchema.parse(JSON.parse(sessionJson));
  }

  const sessionPath = getSessionPath();
  const file = Bun.file(sessionPath);
  if (!(await file.exists())) {
    throw new Error(
      `Monarch session not found at ${sessionPath}. Run "bun run login" from packages/monarch first.`,
    );
  }
  const raw: unknown = await file.json();
  return MonarchSessionSchema.parse(raw);
}

export function buildCookieHeader(
  cookies: MonarchCookie[],
  nowMs = Date.now(),
): string {
  const valid = cookies.filter((cookie) => {
    if (cookie.expires < 0) return true;
    return cookie.expires * 1000 > nowMs;
  });

  return valid.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function findCsrfToken(session: MonarchSession): string {
  const headerToken =
    session.headers["x-csrftoken"] ?? session.headers["X-Csrftoken"];
  if (headerToken !== undefined && headerToken !== "") return headerToken;

  const cookie = session.cookies.find((c) => c.name === "csrftoken");
  if (cookie !== undefined && cookie.value !== "") return cookie.value;

  throw new Error(
    'Saved Monarch session is missing csrftoken. Run "bun run login" again.',
  );
}

export async function saveMonarchSession(
  session: MonarchSession,
  sessionPath = getSessionPath(),
): Promise<void> {
  await Bun.write(sessionPath, JSON.stringify(session, null, 2));
}
