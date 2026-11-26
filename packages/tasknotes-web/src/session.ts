import { z } from "zod";

export type SavedSession = {
  origin: string;
  token: string;
  remember: boolean;
};

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

const SavedSessionSchema = z.object({
  origin: z.string(),
  token: z.string(),
  remember: z.boolean().optional(),
});

function parseSession(raw: string): SavedSession | null {
  try {
    const parsed = SavedSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      origin: parsed.data.origin,
      token: parsed.data.token,
      remember: parsed.data.remember === true,
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
