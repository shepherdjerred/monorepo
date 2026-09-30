import type { TaskState } from "#src/domain/schemas.ts";

export function failureCountForSave(
  state: TaskState,
  phase: TaskState["phase"],
): number {
  return phase === "publishing" && state.phase === "publishing"
    ? state.failureCount
    : 0;
}
