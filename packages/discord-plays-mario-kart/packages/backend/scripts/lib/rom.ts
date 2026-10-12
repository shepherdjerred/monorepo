// Where the manually run, ROM-gated harnesses find the MK64 ROM. It is
// copyrighted and never in the repo, so none of them run in CI.

const HOME = Bun.env["HOME"] ?? "~";

/**
 * The canonical ROM home: the user's Syncthing folder (replicated per-machine).
 *
 * Two spellings because the Syncthing root differs by machine — `~/Sync` is what
 * the macOS client creates by default, `~/syncthing` is the older layout. Both
 * are checked so the harness works on either without an env var.
 */
export const DEFAULT_ROM_PATHS = [
  `${HOME}/syncthing/Sync/roms/mariokart64.z64`,
  `${HOME}/Sync/Sync/roms/mariokart64.z64`,
] as const;
export const DEFAULT_ROM_PATH = DEFAULT_ROM_PATHS[0];

/**
 * Resolve the MK64 ROM path: explicit arg → `MK64_ROM` env → the Syncthing
 * defaults. Fails fast (with guidance) if none of them exist on disk.
 */
export async function resolveRom(arg?: string): Promise<string> {
  const candidates: string[] = [];
  for (const c of [arg, Bun.env["MK64_ROM"], ...DEFAULT_ROM_PATHS]) {
    if (c != null && c.length > 0) candidates.push(c);
  }
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(
    `MK64 ROM not found. Put it at ${DEFAULT_ROM_PATH} (Syncthing), set ` +
      `MK64_ROM=/path/to/rom.z64, or pass --rom <path>. Tried: ${candidates.join(", ")}`,
  );
}
