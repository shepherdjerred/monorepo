---
title: Multi-Repository Sessions
description: Work with multiple repositories in a single Clauderon session
---

Multi-repository sessions allow you to work with multiple Git repositories simultaneously within a single Clauderon session. This is useful for monorepo migrations, cross-project refactoring, library development with consumer testing, and multi-service development.

## Overview

When creating a multi-repository session:

- Up to **5 repositories** can be added
- Each repository is mounted at a unique **mount point** in the container
- All repositories share the same **agent context** and can be referenced in prompts
- The **primary repository** is the default working directory

## Availability

**Supported Interfaces:**
- ✅ Web UI - Full support for creating and managing multi-repo sessions
- ✅ API - Programmatic multi-repo session creation
- ❌ CLI - Not yet supported (single repo only)
- ❌ TUI - Not yet supported (single repo only)

**Backend Support:**
- ✅ Docker - Full support
- ✅ Zellij - Full support
- ✅ Apple Container - Full support
- ✅ Sprites - Full support
- ⚠️ Kubernetes - Partial support (TODO: volume mounting needs implementation)

## Creating Multi-Repo Sessions

### Via Web UI

1. **Navigate to Create Session**
   - Click "New Session" button
   - The session creation dialog opens

2. **Add Primary Repository**
   - Select or enter path to your primary repository
   - This becomes the default working directory

3. **Add Additional Repositories**
   - Click "Add Repository" button (appears after primary repo selected)
   - Select up to 4 additional repositories
   - Each additional repo requires a **mount name**

4. **Configure Mount Names**
   - Mount name determines the directory path in container
   - Default format: `/workspace/<mount-name>`
   - Example: Mount name "frontend" → `/workspace/frontend`
   - Must be unique across all repositories in session

5. **Complete Session Creation**
   - Configure backend, agent, and other options as usual
   - Click "Create Session"

### Via API

Use the session creation endpoint with multiple repositories:

```bash
curl -X POST http://localhost:3030/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "monorepo-migration",
    "repositories": [
      {
        "path": "/home/user/projects/main-app",
        "mount_name": "main"
      },
      {
        "path": "/home/user/projects/shared-lib",
        "mount_name": "lib"
      },
      {
        "path": "/home/user/projects/api-service",
        "mount_name": "api"
      }
    ],
    "backend": "docker",
    "agent": "claude-code",
    "access_mode": "read-write"
  }'
```

**Response:**
```json
{
  "session_id": "abc123",
  "status": "creating",
  "repositories": [
    {
      "path": "/home/user/projects/main-app",
      "mount_name": "main",
      "mount_point": "/workspace/main"
    },
    {
      "path": "/home/user/projects/shared-lib",
      "mount_name": "lib",
      "mount_point": "/workspace/lib"
    },
    {
      "path": "/home/user/projects/api-service",
      "mount_name": "api",
      "mount_point": "/workspace/api"
    }
  ]
}
```

## Directory Structure

Inside the container, repositories are mounted as:

```
/workspace/
├── main/          # Primary repository (mount_name: "main")
│   ├── src/
│   ├── package.json
│   └── ...
├── lib/           # Additional repository (mount_name: "lib")
│   ├── src/
│   └── ...
└── api/           # Additional repository (mount_name: "api")
    ├── src/
    └── ...
```

The **primary repository** is also the working directory when the session starts.

## Mount Name Conventions

Mount names must:
- Be unique within the session
- Contain only alphanumeric characters, hyphens, and underscores
- Start with a letter
- Be 1-32 characters long

**Good mount names:**
```
frontend
backend
shared-lib
api-v2
user_service
```

**Invalid mount names:**
```
Frontend    # Uppercase not recommended
api/v2      # Slashes not allowed
-backend    # Cannot start with hyphen
```

## Working with Multiple Repositories

### In Agent Prompts

Reference repositories by their mount names:

```
"Refactor the authentication logic in /workspace/main/src/auth.ts
to use the shared utilities from /workspace/lib/src/utils/auth.ts"
```

```
"Update the API endpoint in /workspace/api to call the new
method from /workspace/main/src/services/user.ts"
```

### Environment Variables

Each repository's mount point is available via environment variable:

```bash
# In container
echo $CLAUDERON_REPO_MAIN     # /workspace/main
echo $CLAUDERON_REPO_LIB      # /workspace/lib
echo $CLAUDERON_REPO_API      # /workspace/api
```

Environment variable naming:
- Prefix: `CLAUDERON_REPO_`
- Suffix: Mount name in uppercase with hyphens converted to underscores
- Example: `shared-lib` → `CLAUDERON_REPO_SHARED_LIB`

### Git Operations

Each repository maintains its own Git state:

```bash
# In container
cd /workspace/main
git status  # Shows main repo status

cd /workspace/lib
git status  # Shows lib repo status
```

Hooks run independently for each repository.

## Use Cases

### Monorepo Migration

Migrating from multiple repositories to a monorepo:

```
Session: "monorepo-migration"
Repositories:
  - packages/frontend (from old frontend repo)
  - packages/backend (from old backend repo)
  - packages/shared (from old shared repo)

Prompt: "Help me merge these three repositories into a monorepo
structure under /workspace/main, preserving git history"
```

### Cross-Project Refactoring

Refactoring shared code across multiple projects:

```
Session: "auth-refactor"
Repositories:
  - main-app
  - admin-dashboard
  - mobile-api

Prompt: "Update all three projects to use the new authentication
flow from main-app/src/auth"
```

### Library + Consumer Testing

Developing a library alongside a consumer application:

```
Session: "ui-lib-dev"
Repositories:
  - ui-library (your library)
  - demo-app (consumer app)

Prompt: "Add a new Button component to ui-library and demonstrate
its usage in demo-app"
```

### Multi-Service Development

Working with microservices that need coordination:

```
Session: "user-service-integration"
Repositories:
  - user-service
  - auth-service
  - api-gateway

Prompt: "Update the user service endpoint and modify the API gateway
to route requests correctly"
```

### Monorepo Exploration

Navigating large monorepos by mounting subdirectories:

```
Session: "explore-packages"
Repositories:
  - packages/web (mount from monorepo/packages/web)
  - packages/mobile (mount from monorepo/packages/mobile)

Note: Each subdirectory is treated as separate repo
```

## Limitations

### Kubernetes Backend

Multi-repository support for Kubernetes backend is **not fully implemented**. The TODO exists in the codebase for:
- Multiple persistent volume claims
- Volume mount orchestration
- Pod template updates

**Workaround:** Use Docker or other backends for multi-repo sessions.

### CLI and TUI

Multi-repository sessions can only be created via:
- Web UI
- API

The CLI and TUI currently support single repository only.

**Workaround:** Create session via Web UI, then attach via CLI/TUI:

```bash
# Create via Web UI with multiple repos
# Then attach from CLI
clauderon attach my-multi-repo-session
```

### Maximum Repository Count

Hard limit of **5 repositories** per session.

**Reason:** Performance and complexity management. For more repositories, consider:
- Using a monorepo
- Creating multiple sessions
- Using git submodules or worktrees

### Working Directory

The primary repository (first in list) is the initial working directory. Agents may need explicit paths to operate on other repositories.

**Best Practice:** Include mount points in prompts:

```
"Update /workspace/lib/package.json and /workspace/api/package.json"
```

## Configuration

### Repository Order

The order of repositories matters:
1. **First repository** - Primary, default working directory
2. **Additional repositories** - Mounted at specified paths

Reorder in Web UI by drag-and-drop (if supported) or recreate session with different order.

### Mount Point Customization

Currently, mount points are automatically determined:
- Format: `/workspace/<mount-name>`
- Not user-customizable

**Future enhancement:** Custom mount point paths may be supported.

### Backend-Specific Configuration

**Docker:**
- Each repository creates a bind mount or volume
- Docker volume mode applies to all repositories
- Permissions inherited from host filesystem

**Zellij:**
- Each repository accessible in filesystem
- No special mounting needed (local execution)

**Apple Container:**
- Each repository mounted into container
- Apple security prompts may appear for each directory

**Sprites:**
- Each repository cloned remotely on sprites.dev
- Clone time proportional to number of repos
- Network bandwidth considerations for large repos

## Troubleshooting

### Mount Point Conflicts

**Problem:** Two repositories have conflicting mount names

**Solution:**
- Ensure mount names are unique
- Use descriptive names that won't collide
- Check existing session configuration before adding repos

### Permission Issues

**Problem:** Agent cannot access files in additional repositories

**Causes:**
- Host filesystem permissions too restrictive
- Docker volume permissions mismatch
- SELinux or AppArmor policies

**Solution:**
```bash
# Check permissions on host
ls -la /path/to/repo

# Ensure readable by Docker user (or your backend)
chmod -R 755 /path/to/repo

# For Docker, check volume mounts
docker inspect <container-id>
```

### Path Resolution Errors

**Problem:** Agent cannot find files in additional repositories

**Causes:**
- Incorrect mount point in prompt
- Repository not fully mounted
- Container not yet ready

**Solution:**
- Verify mount points via API or Web UI
- Use absolute paths starting with `/workspace/`
- Check session health status before issuing commands

### Git State Confusion

**Problem:** Git operations affect wrong repository

**Causes:**
- Working directory not changed
- Relative paths used instead of absolute
- Hook configuration applies to wrong repo

**Solution:**
```bash
# Always use absolute paths
cd /workspace/main
git status

# Or use git -C flag
git -C /workspace/lib status
```

### Backend Support Issues

**Problem:** Kubernetes backend fails with multi-repo sessions

**Status:** Known limitation - not yet implemented

**Workaround:**
- Use Docker backend instead
- Or create separate sessions per repository
- Or wait for Kubernetes multi-repo support

### Performance Degradation

**Problem:** Session creation or agent responses slow with multiple repos

**Causes:**
- Large repositories (multiple GB each)
- Slow network (for Sprites backend)
- Many repositories (approaching 5 repo limit)

**Solutions:**
- Use sparse clones for large repos (future feature)
- Limit to 2-3 repos if possible
- Use local backends (Docker, Zellij) for faster setup
- Consider monorepo instead of multiple repos

## API Reference

### Create Multi-Repo Session

```
POST /api/sessions
```

**Request Body:**
```json
{
  "name": "session-name",
  "repositories": [
    {
      "path": "/absolute/path/to/repo1",
      "mount_name": "main"
    },
    {
      "path": "/absolute/path/to/repo2",
      "mount_name": "lib"
    }
  ],
  "backend": "docker",
  "agent": "claude-code"
}
```

**Validation:**
- `repositories` array: 1-5 items
- `path`: Must be absolute path to Git repository
- `mount_name`: Must be unique, alphanumeric with hyphens/underscores

### Get Session Repositories

```
GET /api/sessions/{id}
```

**Response includes:**
```json
{
  "id": "session-id",
  "repositories": [
    {
      "path": "/home/user/repo1",
      "mount_name": "main",
      "mount_point": "/workspace/main"
    },
    {
      "path": "/home/user/repo2",
      "mount_name": "lib",
      "mount_point": "/workspace/lib"
    }
  ]
}
```

## Best Practices

1. **Primary repository first** - Put the main codebase as the first repository
2. **Descriptive mount names** - Use names that clearly identify the repository
3. **Limit repository count** - Use 2-3 repos unless absolutely necessary
4. **Absolute paths in prompts** - Reference files with full `/workspace/` paths
5. **Test with single repo first** - Ensure session works before adding more repos
6. **Document mount names** - Keep track of which mount name maps to which repo
7. **Use appropriate backend** - Docker for most use cases, avoid Kubernetes for now

## See Also

- [Web Interface](/guides/web-ui/) - Creating multi-repo sessions in Web UI
- [Docker Backend](/guides/docker/) - Docker-specific configuration
- [API Reference](/reference/api/) - Full API documentation
- [Quick Start](/getting-started/quick-start/) - Getting started with sessions
