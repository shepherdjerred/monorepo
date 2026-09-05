# TaskNotes wire-type constraints

This source-only package is a member of the root Bun workspace. Root
`bun install --frozen-lockfile` covers it; do not restore per-package installs
or the stale `file:` dependency model.

- Export only the current `/v2` TaskNotes plugin contract. App-internal
  camelCase types belong in the app and transform at its wire boundary.
- Zod schemas are the source of truth and TypeScript types are inferred.
- Field names match the upstream wire contract, including `details` and
  snake_case recurrence fields.
- The upstream model uses Zod 3 while consumers use Zod 4. Keep explicit Zod 4
  wire mirrors and the key-for-key drift tests; do not compose incompatible
  schema instances or cast around them.
- Both `.` and `./v2` exports resolve to the same contract.

```bash
bun run typecheck
bun run test
bun run lint
```
