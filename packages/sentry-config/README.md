# Sentry configuration

`@shepherdjerred/sentry-config` owns the shared Sentry data collection policy
for browser and Bun applications. Its runtime export is pure and browser safe.

```ts
import { sentryDataCollection } from "@shepherdjerred/sentry-config";

Sentry.init({
  dataCollection: sentryDataCollection(),
  // The application supplies its DSN, release, environment, and integrations.
});
```

Browser applications can use `sentryBrowserOptions({ dsn, environment, release })`
to include the same policy and validate an untyped build-time release value.
The application still supplies its own DSN and environment.

Sentry 11 collects additional data by default. The factory explicitly retains
the previous policy: no automatic user information, cookies, HTTP bodies,
GenAI input/output, database query data, queue data, or GraphQL documents and
variables. Header and query filters retain useful context while excluding
forwarding, IP, remote, and user fields. Each call creates independent options.

This controls automatic SDK collection. Applications still own explicit user
identity, contexts, breadcrumbs, credential sanitization, and event filters.
It does not redact the separate repository-owned OpenTelemetry pipeline.

Bugsink clients remain error-only. Bun services with their own tracing provider
set `enableOpenTelemetrySetup: false` and keep Sentry tracing disabled; their
OpenTelemetry exporters own traces sent to Tempo and Phoenix.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```
