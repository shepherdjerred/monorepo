---
id: asuswrt-acceptance-test-import-verify-id
type: todo
status: complete
board: false
origin: packages/docs/plans/2026-07-03_asuswrt-tofu-tracking.md
source_marker: false
---

# asuswrt acceptance tests: ImportStateVerify fails on non-`id` identifiers

Three `terraform-provider-asuswrt` acceptance tests fail under `TF_ACC=1 go test
./...` (confirmed pre-existing on `b8c259972`, before PR #1389's Codex-findings
fix commits):

- `TestAccNvramResource_basic`
- `TestAccDHCPStaticLeaseResource_basic`
- `TestAccPortForwardResource_basic`

All three fail identically:

```
testing_new_import_state.go:329: ImportStateVerify: New resource missing
identifier attribute "id", ensure attribute value is properly set or use
ImportStateVerifyIdentifierAttribute to choose different attribute
```

These resources use a natural key (NVRAM key, MAC address, rule name) instead
of an `id` attribute, but their `resource.TestStep{ImportStateVerify: true}`
blocks don't set `ImportStateVerifyIdentifierAttribute` to point at that key.

Not caught by CI: no Buildkite step sets `TF_ACC=1`, so these acceptance
tests are silently skipped (`resource.Test` calls `t.Skip` without it).

## Remaining

- [x] Add `ImportStateVerifyIdentifierAttribute` (pointing at `key`, `mac`, and
      `name` respectively) to the `ImportStateVerify` step in each of the three
      tests, then confirm `TF_ACC=1 go test ./internal/provider/...` is fully
      green.

## Comment Log

- 2026-08-03: Set `ImportStateVerifyIdentifierAttribute` to `key`/`mac`/`name` on
  the nvram, dhcp-static-lease, and port-forward `ImportStateVerify` steps.
  `TF_ACC=1 go test ./internal/provider/...` passes (the mock server backs the
  acceptance tests, so no real router is needed). Resolves Codex P2 on
  `dhcp_static_lease_resource_test.go`.
