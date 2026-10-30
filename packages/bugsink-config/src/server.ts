import type { DataCollection } from "@sentry/core";
import { bugsinkDataCollection } from "./index.ts";

/**
 * Fail when any `SENTRY_*` variable is set. The Node SDK falls back to these
 * for undefined options and reads trace propagation ones unconditionally, so
 * Bugsink configuration must come only from the application's `BUGSINK_*`
 * settings.
 */
export function assertNoSentryEnvironment(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): void {
  const present = Object.keys(env)
    .filter((key) => key.startsWith("SENTRY_") && env[key] !== undefined)
    .toSorted();
  if (present.length > 0) {
    throw new Error(
      `Unsupported Sentry SDK environment variables: ${present.join(", ")}. Configure Bugsink through BUGSINK_* settings.`,
    );
  }
}

/**
 * Explicit Sentry SDK options for Bun Bugsink clients. Tracing stays
 * unset: any `tracesSampleRate`, including 0, enables SDK span recording, and
 * traces belong to the repository's OpenTelemetry pipeline.
 */
export function bugsinkServerOptions({
  dsn,
  environment,
  release,
  env = Bun.env,
}: {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  env?: Readonly<Record<string, string | undefined>>;
}): {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  debug: false;
  dataCollection: DataCollection;
} {
  assertNoSentryEnvironment(env);
  return {
    dsn,
    environment,
    release,
    debug: false,
    dataCollection: bugsinkDataCollection(),
  };
}
