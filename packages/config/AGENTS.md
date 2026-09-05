# Layered configuration constraints

This package resolves `flag -> env -> file -> default` behind a Zod-typed call
site and returns both value and provenance. See `README.md` for the API.

- Fall through only on absence. `false`, `0`, and every other resolved value
  stop resolution.
- A source failure is observed and may fall through. A present invalid value
  throws. An empty environment string is absent.
- The default must represent safe current production behavior and is parsed by
  the declared schema.
- Environment and file inputs are strings; use coercing schemas when the target
  is numeric or boolean.
- `sources: ["env"]` asserts that a key is credential/bootstrap. Behavioral
  keys must be able to migrate to flags. Reject an empty sources list.
- Mark credentials `sensitive` so diagnostics emit only provenance and digest.
- Mark per-entity keys `targeted`; cache observations by key and targeting key,
  but never put a targeting key in metric labels.
- Do not add a dependency on `@shepherdjerred/feature-flags`. The Flipt adapter
  is injected from the feature-flags package so distributed apps stay light.
- Evaluate whether the read is per-call, session-scoped, or boot-wired. A
  boot-wired flag still requires a restart.

Changes and source failures are logged; hot-path reads only count. Preserve old
value, new value, and selected layer in change diagnostics.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```
