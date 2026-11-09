---
title: Prune the CI mise install claim
description: Free space on the woodpecker-mise-installs claim by deleting tool versions that main's mise.lock no longer pins.
---

When `ZfsPVCStorageHigh` names `woodpecker-ci/woodpecker-mise-installs`,
delete the tool versions on the claim that main's `mise.lock` no longer pins;
the claim has no collector, so this is the only way it shrinks.

The claim holds mise's install and download roots for tool versions the
pinned CI image lacks. A version lands there once per node when a pipeline
first needs it, and the next image promotion makes it redundant without
removing it. Every directory on it is re-installable, so deleting a version a
pipeline still needs costs one install, not a failure.

## 1. Read the pinned versions from main

```bash
git fetch origin main
git show origin/main:mise.lock | rg -n '^\[\[tools\.|^version'
```

Each `[[tools."<name>"]]` entry is followed by the one `version` it pins.
Those are the directories to keep: `installs/<tool>/<version>` and the
matching archives under `downloads/<tool>/<version>`. mise names a tool
directory after its lock entry with `:` and `/` replaced by `-`, so
`aqua:ip7z/7zip` lives under `aqua-ip7z-7zip`; core tools such as `java` keep
their names.

## 2. Mount the claim in a one-off pod

The claim is `ReadWriteMany` and provisioned on liskov, so a pod that selects
liskov can mount it beside running CI pods.

```bash
kubectl -n woodpecker-ci run mise-prune --rm -it --restart=Never \
  --image=docker.io/library/alpine:3.22 \
  --overrides='{
    "metadata": {"labels": {"kueue.x-k8s.io/queue-name": "default"}},
    "spec": {
      "nodeSelector": {"kubernetes.io/hostname": "liskov"},
      "containers": [{
        "name": "mise-prune",
        "image": "docker.io/library/alpine:3.22",
        "command": ["sh"],
        "stdin": true,
        "tty": true,
        "resources": {
          "requests": {"cpu": "100m", "memory": "128Mi", "ephemeral-storage": "256Mi"},
          "limits": {"cpu": "100m", "memory": "128Mi", "ephemeral-storage": "256Mi"}
        },
        "volumeMounts": [{"name": "mise", "mountPath": "/woodpecker/mise-installs"}]
      }],
      "volumes": [{"name": "mise", "persistentVolumeClaim": {"claimName": "woodpecker-mise-installs"}}]
    }
  }' -- sh
```

The [CI pod guard](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/woodpecker/ci-pod-guard.ts)
rejects a pod in this namespace that does not select liskov by hostname or
leaves a container without requests and limits, which is why the overrides set
both. Kueue gates the pod on the compute queue like any CI pod; it starts when
it fits the budget. The container runs as root, which the claim's files need:
CI steps install as root.

## 3. List what the claim holds

```bash
du -sh /woodpecker/mise-installs/installs/*/* | sort -h
du -sh /woodpecker/mise-installs/downloads/*/* | sort -h
```

Compare each `<tool>/<version>` with step 1. Anything the image already
carries never appears here, so every listed version is a runtime install.

## 4. Delete the versions main no longer pins

Name each directory exactly. Do not pass a tool directory or the claim root to
a recursive delete.

```bash
rm -rf /woodpecker/mise-installs/installs/<tool>/<version>
rm -rf /woodpecker/mise-installs/downloads/<tool>/<version>
```

Leave the pinned versions and mise's lock files in place. A step that is
installing while you prune holds a lock file beside its destination; skip any
version whose directory is still changing and return to it after the step
finishes.

## 5. Verify the space came back

```bash
df -h /woodpecker/mise-installs
```

Usage must now sit below the 75% that raised the alert. Exit the shell; the
pod deletes itself. `ZfsPVCStorageHigh` resolves on its next evaluation once
`zfs_dataset_used_bytes` reflects the deletion.

If the claim fills again before the next image promotion, the pinned image is
missing too many tools; promote the image rather than growing the claim.

## Related

- [Why CI jobs queue instead of failing](/explanation/homelab/ci-admission/)
- [Expand a ZFS workload volume](/how-to/expand-a-zfs-workload-volume/)
