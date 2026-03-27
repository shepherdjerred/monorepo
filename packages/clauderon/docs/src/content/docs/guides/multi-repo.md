---
title: Multi-Repository Sessions
description: Work with multiple repositories in a single Clauderon session
---

Up to **5 repositories** per session, each mounted at `/workspace/<mount-name>`. The primary repository is the default working directory.

## Availability

| Interface | Support | Backend | Support |
| --------- | ------- | ------- | ------- |
| Web UI    | ✅      | Docker  | ✅      |
| API       | ✅      | Zellij  | ✅      |
| CLI/TUI   | ❌      |         |         |

## Creating via API

```bash
curl -X POST http://localhost:3030/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "monorepo-migration",
    "repositories": [
      { "path": "/home/user/projects/main-app", "mount_name": "main" },
      { "path": "/home/user/projects/shared-lib", "mount_name": "lib" },
      { "path": "/home/user/projects/api-service", "mount_name": "api" }
    ],
    "backend": "docker",
    "agent": "claude-code",
    "access_mode": "read-write"
  }'
```

## Container Directory Structure

```
/workspace/
├── main/          # Primary repository (mount_name: "main")
├── lib/           # mount_name: "lib"
└── api/           # mount_name: "api"
```

## Mount Name Rules

- Unique within session, 1-32 chars
- Alphanumeric, hyphens, underscores only
- Must start with a letter

## Environment Variables

Each repo's mount point is available as `CLAUDERON_REPO_<MOUNT_NAME_UPPER>`:

```bash
echo $CLAUDERON_REPO_MAIN       # /workspace/main
echo $CLAUDERON_REPO_SHARED_LIB # /workspace/shared-lib → SHARED_LIB
```

## Git Operations

Each repository maintains independent git state:

```bash
cd /workspace/main && git status   # main repo
cd /workspace/lib && git status    # lib repo
git -C /workspace/lib status       # alternative
```

## Limitations

- **Max 5 repos** per session
- CLI/TUI: single repo only (workaround: create via Web UI, then `clauderon attach`)
- Mount points fixed at `/workspace/<mount-name>` (not customizable)
- Primary repo (first in list) is initial working directory

## Backend Notes

| Backend | Behavior                                                             |
| ------- | -------------------------------------------------------------------- |
| Docker  | Each repo creates a bind mount or volume; volume mode applies to all |
| Zellij  | Direct filesystem access, no special mounting                        |

## Troubleshooting

| Problem                               | Solution                                                |
| ------------------------------------- | ------------------------------------------------------- |
| Mount name conflict                   | Ensure unique names                                     |
| Permission denied on additional repos | Check host permissions: `chmod -R 755 /path/to/repo`    |
| Agent can't find files                | Use absolute `/workspace/` paths; verify session health |
| Git affects wrong repo                | Use `git -C /workspace/<name>` or `cd` first            |
| Slow with many repos                  | Limit to 2-3 repos; use local backends                  |
