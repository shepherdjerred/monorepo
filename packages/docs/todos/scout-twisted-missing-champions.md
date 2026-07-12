---
id: scout-twisted-missing-champions
status: active
origin: packages/docs/plans/2026-07-11_fix-temporal-weekly-refreshes.md
---

# Bump twisted so scout recognizes Locke and Zaahen

The `scout-data-dragon-weekly-refresh` runs (and the 2026-07-11 local proof run)
warn:

```
⚠ Twisted does not recognize 2 champion(s): Locke (id 805), Zaahen (id 904). Bump twisted to pick them up.
```

Non-fatal today (the updater generates `championNameOverrides.generated.ts`
entries), but match analysis for these champions depends on the twisted
library's champion enum. Bump `twisted` in
`packages/scout-for-lol` once a release including Locke (805) and Zaahen (904)
ships, then confirm the warning disappears from the next data-dragon run.
