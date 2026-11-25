import { vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = Bun.env["ERRORS_URL"];
const ORIGINAL_TOKEN = Bun.env["ERRORS_TOKEN"];

export const ORIGINAL_ERRORS_FETCH = ORIGINAL_FETCH;

export function restoreErrorsTestEnvironment(): void {
  vi.restoreAllMocks();
  globalThis.fetch = ORIGINAL_FETCH;
  for (const [key, saved] of [
    ["ERRORS_URL", ORIGINAL_URL],
    ["ERRORS_TOKEN", ORIGINAL_TOKEN],
  ] as const) {
    if (saved === undefined) {
      Reflect.deleteProperty(Bun.env, key);
    } else {
      Bun.env[key] = saved;
    }
  }
}
