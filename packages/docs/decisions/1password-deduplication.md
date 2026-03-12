# 1Password Secret Deduplication

Date: 2026-03-08

## Context

Audit of all 1Password items referenced in the monorepo found duplicate secret values across vaults and items. The GitHub Actions vault was deleted entirely (CI is on Buildkite). Remaining duplicates were categorized and resolved.

**Constraint**: The K8s 1Password Connect operator only has access to the `Homelab (Kubernetes)` vault. K8s secrets are namespace-scoped.

## Duplicates — Action Plan

| #   | Duplicate                   | Items                                                       | Action                                                             | Files to Change                             |
| --- | --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| 1   | **Cloudflare Account ID**   | R2 Exporter, CF Operator, Buildkite CI, Personal/Cloudflare | **Hardcode in code** — not a secret                                | `r2-exporter.ts`, `tofu/.env`               |
| 2   | **S3 Keys (Scout)**         | `seaweedfs-s3-credentials` vs Scout Beta + Prod             | **Consolidate** — point to canonical 1P item                       | `scout/index.ts`                            |
| 3   | **S3 Keys (Buildkite)**     | `seaweedfs-s3-credentials` vs Buildkite CI Secrets          | **Accept** — `envFrom` pattern requires all env vars in one secret | —                                           |
| 4   | **MC Discord Bot Token**    | `minecraft-sjerred-discord` vs `minecraft-tsmc-discord`     | **Consolidate** — one 1P item, two CRDs (different namespaces)     | `minecraft-sjerred.ts`, `minecraft-tsmc.ts` |
| 5   | **Obsidian Vault Password** | Homelab/tasknotes-server vs Personal/Obsidian Vault         | **Accept** — user wants to keep Personal copy                      | —                                           |
| 6   | **GitHub PAT**              | Buildkite CI Secrets vs Dependency Summary                  | **Accept** — different namespaces, Buildkite `envFrom` pattern     | —                                           |
| 7   | **Riot API Key**            | Scout Beta vs Scout Prod                                    | **Accept** — intentional per-stage separation                      | —                                           |

## Summary

| Category                         | Count |
| -------------------------------- | ----- |
| Hardcode in code                 | 1     |
| Consolidate in 1P + update cdk8s | 2     |
| Accept (inherent to pattern)     | 4     |

## Accepted Duplications — Rationale

- **Obsidian Vault Password**: User wants Personal copy for non-K8s access
- **Buildkite CI Secrets S3 keys**: `envFrom` mega-secret pattern requires all env vars in one K8s secret; splitting would require renaming env vars across CI scripts
- **Buildkite CI Secrets GitHub PAT**: Same `envFrom` pattern reason
- **Riot API Key (Scout Beta/Prod)**: Intentionally separate per-stage items that may diverge

## Tooling

Duplicate checker script: `scripts/check-1p-duplicates.py`

```bash
python3 scripts/check-1p-duplicates.py --workers 16 --min-length 8
```

Filters out non-secret fields (usernames, emails, URLs, noise values) and only reports duplicates across different items.
