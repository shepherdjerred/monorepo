export function actionError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Facet could not complete this action.";
}

export async function reportAction(
  action: () => Promise<unknown>,
  onError?: (message: string) => void,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    onError?.(actionError(error));
  }
}
