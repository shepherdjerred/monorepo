import type { Database } from "#infrastructure/database.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";

export async function requireActiveRuntime(
  db: Database,
): Promise<{ active: boolean; epoch: number }> {
  return await runtimeAuthority(db);
}
