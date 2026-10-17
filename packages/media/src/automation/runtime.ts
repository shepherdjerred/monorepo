import type { Database } from "#infrastructure/database.ts";

export async function requireActiveRuntime(
  db: Database,
): Promise<{ active: boolean; epoch: number }> {
  const state = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (state.mode !== "observe" && state.mode !== "active")
    throw new Error("Invalid media runtime mode");
  return {
    active: state.mode === "active" && state.ownershipConfirmed,
    epoch: state.recoveryEpoch,
  };
}
