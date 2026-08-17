/**
 * Runs a Discord SDK call whose result nothing awaits.
 *
 * `void somePromise()` discards the promise without handling rejection, so a
 * failed SDK command both drops its side effect and surfaces as an
 * `unhandledrejection` on the page. Every caller here is best-effort presence
 * or teardown work that must not take the Activity down, so failures are
 * reported rather than thrown.
 */
export function fireAndForget(
  operation: () => Promise<void>,
  label: string,
  onError?: (error: unknown) => void,
): void {
  void (async () => {
    try {
      await operation();
    } catch (error) {
      console.error(`Scout Customs Activity: ${label} failed`, error);
      onError?.(error);
    }
  })();
}
