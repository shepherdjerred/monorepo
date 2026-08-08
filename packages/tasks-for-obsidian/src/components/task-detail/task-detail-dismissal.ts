export type TaskDetailDismissRequest<Action> =
  | { readonly kind: "go-back" }
  | { readonly kind: "dispatch"; readonly action: Action };

export function shouldPreventTaskDetailRemove<Action>(
  dirty: boolean,
  request: TaskDetailDismissRequest<Action> | null,
): boolean {
  return dirty && request === null;
}

export function shouldDismissMissingTask(
  wasResolved: boolean,
  isResolved: boolean,
): boolean {
  return wasResolved && !isResolved;
}
