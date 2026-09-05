---
name: argocd-helper
description: "Use this skill for Inspect, configure, and troubleshoot Argo CD Applications, syncs, health, diffs, projects, repos…"
---

# Argo CD helper

Start read-only and establish the Application, destination, declared source,
requested revision, project, sync policy, and resource ownership.

Useful read operations include:

```bash
argocd app get <app>
argocd app diff <app>
argocd app history <app>
argocd app manifests <app> --revision <revision>
argocd app resources <app>
argocd app logs <app>
```

Correlate Argo CD's view with Kubernetes objects and controller events. Separate
Git source, render errors, comparison, sync operation, health assessment, and
application runtime behavior.

Before a sync, rollback, terminate, delete, or prune operation:

1. resolve the exact target and revision;
2. inspect active operations and ownership markers;
3. understand hooks, waves, finalizers, sync options, ignored differences, and
   prune propagation;
4. preview the diff or rendered manifests;
5. use the repository's owning release workflow when one exists;
6. read back operation and runtime state.

Never classify a resource as safe to prune from `OutOfSync` alone. Never
terminate an operation merely because another operation wants the same
revision; establish ownership.

Read [applicationsets.md](references/applicationsets.md) for generators and
rollouts, [multi-source-and-notifications.md](references/multi-source-and-notifications.md)
for those features, and [troubleshooting.md](references/troubleshooting.md) for
version-aware diagnosis. Verify current flags and semantics against official
Argo CD documentation.
