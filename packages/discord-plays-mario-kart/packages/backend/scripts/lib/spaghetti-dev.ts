// The locally built SpaghettiKart for ROM-gated harnesses: the install that
// `bun run --cwd ../.. build:spaghetti` writes, plus a private cache for the
// ROM-derived game archive. Never used in CI (it needs the ROM).
import path from "node:path";
import {
  prepareSpaghettiBuild,
  type SpaghettiBuild,
} from "#src/engine/spaghetti/install.ts";
import { resolveRom } from "./rom.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const SPAGHETTI_DEV_CACHE = path.join(PACKAGE_ROOT, ".cache/spaghetti");

export async function loadDevSpaghettiBuild(
  rom?: string,
): Promise<SpaghettiBuild> {
  return prepareSpaghettiBuild({
    installDir: path.join(SPAGHETTI_DEV_CACHE, "dist"),
    romPath: await resolveRom(rom),
    cacheDir: path.join(SPAGHETTI_DEV_CACHE, "assets"),
  });
}
