---
name: posthog-operations
description: Query or manage this repository's PostHog analytics, schema, dashboards, insights, feature flags, experiments, replay, and observability through toolkit posthog. Use for analytics investigations or governed PostHog changes.
---

# PostHog operations

Use the agent-first API surface and ambient credential:

```bash
toolkit posthog --version
toolkit posthog api search read-data-schema
toolkit posthog api info read-data-schema
toolkit posthog api call read-data-schema '{"query":{"kind":"events"}}'
```

Before querying, discover the live event and property schema. Do not guess event
names or property types from source alone. Scope time range, environment,
identity, and grouping explicitly.

Before a mutation:

1. identify the repository/OpenTofu owner and avoid dashboard drift;
2. inspect the exact API tool and every hinted schema field;
3. perform a dry run when supported;
4. require confirmation only for the user-authorized target;
5. read the object back and exercise the query where practical.

Source instrumentation, an accepted capture request, stored events, and a
working insight are separate acceptance claims. Use live events or the API to
prove storage. Never print, persist, or pass the PostHog token in command text.
