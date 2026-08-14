---
id: tasknotes-windows-buildkite-worker
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-08-11_tasknotes-windows-quality-hardening.md
---

# Provision the TaskNotes Windows Buildkite worker

The checked-in Windows lane remains deliberately inactive until Buildkite has
trusted, unlocked Windows 11 x64 desktop capacity for packaged UI automation.

## Remaining

- [ ] Provision unlocked interactive workers tagged for every real 100% and
      200% light, dark, and high-contrast profile.
- [ ] Install the pinned mise toolchains and Visual Studio WinUI workload.
- [ ] Trust a machine-scoped development certificate without storing its
      private key, thumbprint, or token in the repository.
- [ ] Enable `packages/tasknotes-windows/ci/windows-buildkite.pipeline.yml` and
      upload its JUnit, TRX, Cobertura, MSIX, and failure artifacts.
- [ ] Require the lane before packaged Windows tests are described as
      CI-enforced.

## Comment Log

- 2026-08-11: Lane contract prepared but intentionally not connected to the
  repository pipeline because no suitable interactive worker exists.
