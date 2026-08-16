import { context, diag, metrics, propagation, trace } from "@opentelemetry/api";
import { logs as logsAPI } from "@opentelemetry/api-logs";

/**
 * Unregister every OpenTelemetry global this repo's initializers install.
 *
 * Each `setGlobalXProvider` is one-shot per process: while a provider is still
 * registered, a later registration silently returns false and the caller keeps
 * a provider nothing routes through. `bun test` runs every file in one
 * process, so a suite that registers globals and does not unregister them
 * leaves the next file emitting into its shut-down providers — spans and logs
 * vanish, no error is raised, and which file wins depends on file order.
 *
 * `disable()` both disables and unregisters, so the API falls back to its noop
 * implementation. Prefer this over disabling a manager instance directly: an
 * instance that is disabled but still registered is worse than none, because
 * `context.with` then delegates into a dead AsyncLocalStorage.
 *
 * Call from `afterAll`/`afterEach` in any suite that initializes telemetry.
 * Resetting an API nothing registered is a no-op, so the full reset is always
 * safe — which is why this takes no arguments to get wrong. `NodeSDK.start()`
 * in particular registers a MeterProvider that is easy to forget.
 */
export function resetOtelGlobals(): void {
  trace.disable();
  context.disable();
  propagation.disable();
  metrics.disable();
  logsAPI.disable();
  diag.disable();
}
