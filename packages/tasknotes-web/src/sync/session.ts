import { z } from "zod";
import { SyncHttpError, type SyncFetch } from "./sync.ts";

const PrincipalSchema = z.object({
  kind: z.enum(["admin", "api_token"]),
  user_id: z.string().min(1),
  scopes: z.array(z.enum(["read", "write"])),
});

export type WorkspacePrincipal = z.infer<typeof PrincipalSchema>;

export type SavedSession = {
  origin: string;
  token: string;
  remember: boolean;
  principal?: WorkspacePrincipal;
  logoutEpoch?: string;
};

export type VerifiedSession = SavedSession & { principal: WorkspacePrincipal };

export type KeyValueStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const LOCAL_KEY = "tasknotes.web.session";
const TAB_KEY = "tasknotes.web.session.tab";

const LOCAL_PROXY_ORIGIN = "http://127.0.0.1:3000";

export function syncEndpoint(origin: string): string {
  const trimmed = origin.trim().replace(/\/$/, "");
  return trimmed === "" || trimmed === LOCAL_PROXY_ORIGIN
    ? "/api/v1/sync"
    : `${trimmed}/api/v1/sync`;
}

export function connectionOrigin(origin: string, pageOrigin: string): string {
  const trimmed = origin.trim().replace(/\/$/, "");
  if (
    trimmed === "" ||
    trimmed === LOCAL_PROXY_ORIGIN ||
    trimmed === pageOrigin
  )
    return "";
  const url = new URL(trimmed, pageOrigin);
  if (url.protocol !== "https:" || url.origin !== trimmed) {
    throw new Error("Enter the HTTPS origin of your Facet server.");
  }
  return url.origin;
}

export async function verifyPrincipal(input: {
  origin: string;
  token: string;
  fetchImpl?: SyncFetch | undefined;
  signal?: AbortSignal | undefined;
}): Promise<WorkspacePrincipal> {
  const headers = new Headers({ accept: "application/json" });
  if (input.token !== "") headers.set("authorization", `Bearer ${input.token}`);
  const response = await (input.fetchImpl ?? fetch)(
    `${input.origin}/api/v1/whoami`,
    {
      headers,
      cache: "no-store",
      redirect: "error",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
  if (!response.ok) throw new SyncHttpError(response.status);
  const principal = z
    .object({ principal: PrincipalSchema })
    .parse(await response.json()).principal;
  if (!principal.scopes.includes("read"))
    throw new Error("This token cannot read the workspace.");
  return principal;
}

const SavedSessionSchema = z.object({
  origin: z.string(),
  token: z.string(),
  remember: z.boolean().optional(),
  principal: PrincipalSchema.optional(),
  logoutEpoch: z.string().optional(),
});

function parseSession(raw: string): SavedSession | null {
  try {
    const parsed = SavedSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      origin: parsed.data.origin,
      token: parsed.data.token,
      remember: parsed.data.remember === true,
      ...(parsed.data.principal === undefined
        ? {}
        : { principal: parsed.data.principal }),
      ...(parsed.data.logoutEpoch === undefined
        ? {}
        : { logoutEpoch: parsed.data.logoutEpoch }),
    };
  } catch (error_: unknown) {
    if (!(error_ instanceof Error)) throw error_;
    return null;
  }
}

export function loadSession(stores: {
  local: KeyValueStore;
  session: KeyValueStore;
}): SavedSession | null {
  const tab = stores.session.getItem(TAB_KEY);
  if (tab !== null) return parseSession(tab);
  const remembered = stores.local.getItem(LOCAL_KEY);
  return remembered === null ? null : parseSession(remembered);
}

export function saveSession(
  stores: { local: KeyValueStore; session: KeyValueStore },
  session: SavedSession,
): void {
  const payload = JSON.stringify(session);
  stores.session.setItem(TAB_KEY, payload);
  if (session.remember) stores.local.setItem(LOCAL_KEY, payload);
  else stores.local.removeItem(LOCAL_KEY);
}

export function clearSession(stores: {
  local: KeyValueStore;
  session: KeyValueStore;
}): void {
  stores.session.removeItem(TAB_KEY);
  stores.local.removeItem(LOCAL_KEY);
}
