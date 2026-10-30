# Bugsink configuration

`@shepherdjerred/bugsink-config` owns the shared Bugsink data collection policy
for browser and Bun applications that report through the Sentry SDK. Its
runtime export is pure and browser safe.

```ts
import { bugsinkDataCollection } from "@shepherdjerred/bugsink-config";

Sentry.init({
  dataCollection: bugsinkDataCollection(),
  // The application supplies its DSN, release, environment, and integrations.
});
```

Browser applications can use `bugsinkBrowserOptions({ dsn, environment, release })`
to include the same policy and validate an untyped build-time release value.
The application still supplies its own DSN and environment.

Sentry SDK 11 collects additional data by default. The factory explicitly
retains the previous policy: no automatic user information, cookies, HTTP
bodies, GenAI input/output, database query data, queue data, or GraphQL
documents and variables. Header and query filters retain useful context while
excluding forwarding, IP, remote, and user fields. Each call creates
independent options.

This controls automatic SDK collection. Applications still own explicit user
identity, contexts, breadcrumbs, credential sanitization, and event filters.
It does not redact the separate repository-owned OpenTelemetry pipeline.

Bugsink clients remain error-only. Bun services with their own tracing provider
set `enableOpenTelemetrySetup: false` and keep SDK tracing disabled; their
OpenTelemetry exporters own traces sent to Tempo and Phoenix.

Applications pass the DSN, release, environment, and sample rates to
`Sentry.init` explicitly from their own `BUGSINK_*` configuration. The SDK
would otherwise read `SENTRY_*` environment variables on its own.

Bun and Node services build their options with `bugsinkServerOptions` from the
`@shepherdjerred/bugsink-config/server` export:

```ts
import { bugsinkServerOptions } from "@shepherdjerred/bugsink-config/server";

Sentry.init({
  ...bugsinkServerOptions({ dsn, environment, release }),
  enableOpenTelemetrySetup: false,
});
```

It sets `debug` explicitly and throws when any `SENTRY_*` variable is present,
because the SDK reads some of them, such as `SENTRY_TRACE` and
`SENTRY_BAGGAGE`, regardless of the options passed. It leaves
`tracesSampleRate` unset, since any value, including 0, enables SDK span
recording.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```
