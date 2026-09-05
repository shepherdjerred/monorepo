---
name: buildkite-helper
description: "Design, inspect, and troubleshoot Buildkite pipelines, steps, agents, plugins, retries, artifacts, APIs, and…"
---

# Buildkite helper

Inspect the repository's current pipeline and Buildkite state before applying
generic guidance. Pipeline shape, queues, plugins, and retry policy are local
decisions and can drift.

## Workflow

1. Identify the pipeline, build, exact commit, job, step key, queue, and agent.
2. Read the pipeline YAML or uploaded pipeline that produced the job.
3. Separate checkout, agent, plugin, command, artifact, and downstream failures.
4. Inspect the job's actual exit status, signal, retry, and `soft_failed` state.
5. Make the smallest source-owned correction and rerun the exact failing path.

Do not infer success from a green sibling build or a retried job with a different
commit. Do not suppress exit codes, make a hard gate soft, or blame a cache
without comparing inputs.

For pipeline syntax and step fields, read
[pipeline-yaml-full.md](references/pipeline-yaml-full.md). For hooks and plugin
order, read [plugins-and-hooks.md](references/plugins-and-hooks.md). For the CLI
and APIs, read [api-reference.md](references/api-reference.md).

For Kubernetes agents, read
[kubernetes-agent-stack.md](references/kubernetes-agent-stack.md) and correlate
Buildkite job state with pod events, container termination, node pressure, and
kernel OOM evidence. A missing Kubernetes event does not prove a container was
not OOM-killed.

Use [advanced-features.md](references/advanced-features.md) only for Test Engine,
Packages, Clusters, or current platform features. Verify version-sensitive
details against official Buildkite documentation.
