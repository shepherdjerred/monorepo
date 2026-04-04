# CI Security Audit: Buildkite + Dagger

**Date:** 2026-04-04
**Status:** Findings documented, remediation deferred until contributors are added

## Summary

Audited the Buildkite + Dagger CI pipeline for security vulnerabilities, specifically around allowing external contributors without exposing secrets, infrastructure, or deployments.

## Current State

- **Fork PR builds are disabled** in Buildkite settings — the critical external attacker vector is closed
- No immediate action required while the repo is single-contributor

## Findings

### Mitigated

- Fork PR secret exfiltration — disabled in Buildkite settings

### To fix before adding contributors

1. **All secrets mounted to all steps** — `k8s-plugin.ts` mounts `buildkite-ci-secrets` on every step including lint/test. A supply chain attack (malicious postinstall script) would exfiltrate everything.
2. **Pipeline generator runs from PR branch** — `generate-pipeline.sh` runs arbitrary TypeScript from the checked-out branch with all secrets (Poisoned Pipeline Execution, OWASP CICD-SEC-4).
3. **No CODEOWNERS on CI code** — `scripts/ci/`, `.dagger/`, `.buildkite/`, `bun.lock` unprotected.

### Defense in depth (lower priority)

4. Split monolithic `buildkite-ci-secrets` into per-purpose K8s secrets
5. Add Buildkite `block` step before `tofu apply`
6. Replace long-lived credentials with Buildkite OIDC
7. Enable pipeline signing (EdDSA)
8. Harden pod security (PSS `baseline`, minimal SA, disable token automount)
9. Pin CI image by digest, sign with cosign
10. Isolate Dagger engine with network policies

### What's already done well

- Fork builds disabled
- Dagger `Secret` type prevents logging
- `--frozen-lockfile` enforced
- Hygiene checker bans dangerous patterns
- Deploy steps gated on main branch
- Gitleaks scanning
- Ephemeral K8s pods per build

## Remediation Plan

Full plan with code changes at `~/.claude-extra/plans/ci-security-audit.pdf` and `~/.claude/plans/binary-meandering-adleman.md`.

**Before enabling fork PR builds or adding collaborators:**

1. Remove secrets from bootstrap step (`.buildkite/pipeline.yml`)
2. Add `noSecrets` mode to `k8s-plugin.ts` for lint/test steps
3. Add CODEOWNERS for CI code + lockfile
4. Implement trusted generator (run from `origin/main` for fork PRs)
5. Add `FORK_MODE` to skip deploy steps for fork PRs
6. Re-enable fork builds in Buildkite settings

## References

- [Buildkite: Managing Pipeline Secrets](https://buildkite.com/docs/pipelines/security/secrets/managing)
- [Buildkite: Enforcing Security Controls](https://buildkite.com/docs/pipelines/best-practices/security-controls)
- [Buildkite: OIDC Authentication](https://buildkite.com/docs/pipelines/security/oidc)
- [Buildkite: Signed Pipelines](https://buildkite.com/docs/agent/self-hosted/security/signed-pipelines)
- [OWASP Top 10 CI/CD Security Risks](https://owasp.org/www-project-top-10-ci-cd-security-risks/)
- [SLSA Supply Chain Levels](https://slsa.dev/spec/v1.0/levels)
