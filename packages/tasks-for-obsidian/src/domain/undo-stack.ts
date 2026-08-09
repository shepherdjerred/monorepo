export type UndoStackEntry = {
  readonly id: number;
  readonly message: string;
  readonly onUndo: () => Promise<boolean>;
};

export type UndoStackAction =
  | { readonly type: "push"; readonly entry: UndoStackEntry }
  | { readonly type: "remove"; readonly id: number }
  | { readonly type: "clear" };

export function undoStackReducer(
  stack: readonly UndoStackEntry[],
  action: UndoStackAction,
): readonly UndoStackEntry[] {
  switch (action.type) {
    case "push":
      return [...stack, action.entry];
    case "remove":
      return stack.filter((entry) => entry.id !== action.id);
    case "clear":
      return [];
  }
}

export function activeUndoEntry(
  stack: readonly UndoStackEntry[],
): UndoStackEntry | null {
  return stack.at(-1) ?? null;
}
