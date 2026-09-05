---
id: agent-sdk-provider-isolation
type: todo
status: planned
board: true
verification: human
disposition: deferred
---

# Restore uid and credential isolation for native SDK agent runs

Moving generic agent tasks from `claude -p` / `codex exec` subprocesses to the
Claude Agent SDK and Codex SDK removed two isolation layers that the CLI path
had, because neither SDK exposes a spawn hook the worker can wrap.

## What was lost

- **uid separation.** `providerSubprocessCommand` used `setpriv --reuid=1001`
  so the agent ran as a different uid from the Temporal poller. The pod-local
  `NET_ADMIN` firewall rules in
  `packages/homelab/src/cdk8s/src/resources/temporal/agent-worker.ts` match on
  `--uid-owner 1001`, so they no longer constrain the agent itself — only the
  deterministic evidence collectors, which still run through `setpriv`.
- **The per-run credential broker.** `agent-provider-credential-broker.ts`
  handed the agent an ephemeral loopback token and injected the real provider
  credential in the parent. It was removed rather than ported: it authenticated
  upstream with `OPENAI_API_KEY` against `https://api.openai.com`, which the
  OpenRouter/native-SDK architecture gate (`scripts/checks/check-ai-architecture.ts`)
  forbids, and Codex agent auth is now the ChatGPT subscription token
  `CODEX_ACCESS_TOKEN` rather than an API key. With the agent sharing the
  worker's uid it could also read the parent's `/proc/<pid>/environ`, so the
  broker no longer provided a real boundary.

## What still holds

- `envForProvider` is a strict **allowlist**: the agent's environment carries
  basic process/TLS settings, the read-only Kubernetes identity, the non-secret
  evidence endpoints, and exactly one provider subscription credential. No
  Postal, S3, GitHub, Temporal, Talos, Grafana, ArgoCD, or direct-provider key
  reaches it.
- Report-only prompts, an ephemeral non-root pod, a throwaway per-run clone,
  the agent service account's absence from every `pods/exec` RoleBinding, and
  the read-only `temporal-worker-audit-reader` ClusterRole.

## Remaining

- [ ] Decide whether the native SDK agent needs uid separation restored, and if
      so how — a wrapper executable passed as `pathToClaudeCodeExecutable` /
      `codexPathOverride` that re-execs under `setpriv` is the only mechanism
      the current SDK surfaces expose.
- [ ] If uid separation is restored, decide whether a credential broker is
      worth reintroducing, and design an upstream that works with subscription
      auth for both providers rather than an OpenAI API key.
- [ ] Re-point or retire the `--uid-owner 1001` firewall rules in
      `agent-worker.ts` so the documented boundary matches what is enforced.

## Comment Log

- 2026-08-11: Recorded while rebasing PR #2104 onto the evidence-backed
  reporting work from PR #2117, so the isolation change is not merged silently.
