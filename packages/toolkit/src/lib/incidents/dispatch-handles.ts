/**
 * Where a won dispatch token waits for the spawned commander session.
 *
 * The token is a bearer credential for `claimDispatch`, and the commander's
 * first message reaches downstream process argv (Herdr's `space.new` call
 * and the agent's launch command), where any local user can read it. So the
 * message carries only an opaque handle; the token sits in a 0600 file under
 * a 0700 directory, which the spawned session (same user, same machine:
 * dispatch always spawns on this computer) redeems with
 * `claim --dispatch-handle`. The file is removed once the claim settles or
 * the spawn fails.
 */
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export type DispatchHandles = {
  /** Store `token`; returns the handle the first message carries. */
  readonly save: (token: string) => Promise<string>;
  /** The token for `handle`, or null when it is not on this machine. */
  readonly read: (handle: string) => Promise<string | null>;
  readonly remove: (handle: string) => Promise<void>;
};

const HANDLE_PATTERN = /^[\w-]{16,64}$/u;
/** Leftovers from sessions that never claimed; their leases lapsed long ago. */
const STALE_MS = 24 * 60 * 60 * 1000;

export function isDispatchHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value);
}

export function defaultDispatchHandleDir(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  home: string = os.homedir(),
): string {
  const state = env["XDG_STATE_HOME"];
  return path.join(
    state === undefined || state === ""
      ? path.join(home, ".local/state")
      : state,
    "toolkit/incident-dispatch",
  );
}

const ErrnoSchema = z.object({ code: z.string() });

function errno(error: unknown): string | null {
  const parsed = ErrnoSchema.safeParse(error);
  return parsed.success ? parsed.data.code : null;
}

async function sweep(dir: string, now: number): Promise<void> {
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    try {
      const info = await stat(file);
      if (now - info.mtimeMs > STALE_MS) await rm(file, { force: true });
    } catch {
      // Removed concurrently.
    }
  }
}

export function fileDispatchHandles(
  dir: string = defaultDispatchHandleDir(),
): DispatchHandles {
  const fileFor = (handle: string) => {
    if (!isDispatchHandle(handle))
      throw new Error(`Not a dispatch handle: ${handle}`);
    return path.join(dir, handle);
  };
  return {
    save: async (token) => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      await sweep(dir, Date.now());
      const handle = randomBytes(18).toString("base64url");
      const file = fileFor(handle);
      const temporary = `${file}.tmp`;
      await writeFile(temporary, token, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, file);
      return handle;
    },
    read: async (handle) => {
      try {
        const token = await readFile(fileFor(handle), "utf8");
        return token.trim();
      } catch (error) {
        if (errno(error) === "ENOENT") return null;
        throw error;
      }
    },
    remove: async (handle) => {
      await rm(fileFor(handle), { force: true });
    },
  };
}
