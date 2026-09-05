# TaskNotes server constraints

This Bun/Hono server exposes the TaskNotes plugin HTTP contract over a Markdown
vault shared with Obsidian. `README.md` owns routes, configuration, and
contributor reference.

- `@tasknotes/model` is the vault engine. Task IDs are URL-encoded
  vault-relative paths.
- Reads may tolerate individual malformed task files only by counting, logging,
  and exposing them through engine status. Root filesystem errors throw.
- Writes are read-modify-write from current disk bytes through model plan
  builders so concurrent Obsidian edits and unknown frontmatter survive.
- The only wire surface is `/api/*`. Request and response schemas come from
  `tasknotes-types`; preserve upstream field names such as `details` and
  snake_case recurrence data.
- Mutation IDs provide restart-safe idempotency. Replays return the stored
  response and never execute twice. Preserve atomic persistence, retention, and
  response headers.
- Watchers use debounce plus max-wait, re-arm after errors, and perform a safety
  rescan. Do not trade missed external edits for lower filesystem activity.
- Validate bearer auth and all boundary data. Do not log tokens or task content.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```

Also run the real-server contract suite in `tasks-for-obsidian` when changing
wire behavior. Unit success, cross-package contract success, shared-volume
behavior, and deployed health are separate acceptance layers.
