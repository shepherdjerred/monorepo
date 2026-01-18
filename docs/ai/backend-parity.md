# Backend Feature Parity Audit

**Date**: 2026-01-18
**Status**: Implementation In Progress

## Executive Summary

This document audits all backend implementations (Docker, Kubernetes, Apple Container, Zellij) against Docker as the baseline to identify feature gaps and ensure consistency across backends.

## Background

The clauderon package provides multiple execution backends that implement the `ExecutionBackend` trait:
- **Docker Backend** (`docker.rs`) - Production-ready, feature-rich container backend
- **Kubernetes Backend** (`kubernetes.rs`) - Pod-based execution for cluster environments
- **Apple Container Backend** (`apple_container.rs`) - macOS 26+ native container runtime
- **Zellij Backend** (`zellij.rs`) - Host-based terminal multiplexer (non-containerized)

All backends implement the same core trait with 5 methods: `create()`, `exists()`, `delete()`, `attach_command()`, and `get_output()`.

## Docker Backend Feature Inventory (Baseline)

The Docker backend at `/workspace/packages/clauderon/src/backends/docker.rs` serves as the feature baseline with the following capabilities:

### Core Features
1. **Container Management**: Create, exists, delete, attach, get_output
2. **Configuration System**: Loads from `~/.clauderon/docker-config.toml`
3. **Image Management**: Pull policy (Always, IfNotPresent, Never), custom images, registry auth
4. **Resource Limits**: CPU and memory constraints via `ResourceLimits`
5. **Extra Flags**: Advanced users can pass custom docker flags

### Caching & Performance
6. **Shared Cache Volumes**: `clauderon-cargo-registry`, `clauderon-cargo-git`, `clauderon-sccache`
7. **sccache Integration**: RUSTC_WRAPPER environment variable for compilation caching
8. **Cache Directory Pre-creation**: Prevents root ownership issues

### Git Integration
9. **Git Worktree Detection**: Automatically detects and mounts parent `.git` directory
10. **Git User Config**: Reads and injects `user.name` and `user.email` into container
11. **Git Config Sanitization**: Prevents environment variable injection attacks

### Proxy Support
12. **HTTP/HTTPS Proxy**: Environment variables for `host.docker.internal` proxy
13. **Proxy CA Certificate**: Mounts and configures CA trust (NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, REQUESTS_CA_BUNDLE)
14. **Talosconfig**: Optional Talos cluster configuration mounting
15. **Codex Config**: Auth.json and config.toml for Codex agent
16. **Token Placeholder Injection**: Dummy tokens for GH_TOKEN, GITHUB_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, etc.

### Claude Code Integration
17. **Plugin Discovery**: Discovers plugins from `~/.claude/plugins/`
18. **Plugin Mounting**: Mounts `known_marketplaces.json` and marketplace directories (read-only)
19. **Plugin Config Generation**: Creates plugin configuration for container
20. **Claude Config**: `.claude.json` with onboarding bypass and optional permissions bypass
21. **Managed Settings**: `managed-settings.json` for proxy environments (bypassPermissions mode)

### Multi-Agent Support
22. **AgentType Support**: ClaudeCode, Codex, Gemini
23. **Agent-Specific Environment**: CODEX_HOME, OPENAI_API_KEY, GEMINI_API_KEY, etc.
24. **Print Mode**: Non-interactive output mode with `--print --verbose` flags
25. **Session Persistence**: Session ID tracking and resume logic

### Container Configuration
26. **User Isolation**: `--user` flag with host UID
27. **Working Directory**: Initial workdir support with translation to container paths
28. **Upload Directory**: Mounts `~/.clauderon/uploads` for image attachments
29. **Home Directory**: Sets HOME=/workspace for non-root execution
30. **Terminal Configuration**: TERM=xterm-256color
31. **Host Gateway**: `--add-host host.docker.internal:host-gateway` for proxy

### Session Management
32. **Session ID**: UUID-based session identification
33. **Session Resume**: Wrapper script detects existing sessions via history file
34. **Fork Session**: `--fork-session` flag for container restart
35. **HTTP Communication**: Hook communication via CLAUDERON_SESSION_ID and CLAUDERON_HTTP_PORT

### Security
36. **Image Name Validation**: Prevents command injection in image names
37. **Git Config Sanitization**: Removes control characters from git config values
38. **Read-only Mounts**: Proxy configs mounted read-only
39. **No Inline Passwords**: Registry auth doesn't support inline passwords
40. **Config Validation**: All configs validated on load

## Feature Comparison Matrix

| Feature | Docker | Kubernetes | Apple Container | Zellij | Gap? |
|---------|--------|-----------|-----------------|--------|------|
| **Core Trait Methods** |
| create() | ✅ | ✅ | ✅ | ✅ | ✅ |
| exists() | ✅ | ✅ | ✅ | ✅ | ✅ |
| delete() | ✅ | ✅ | ✅ | ✅ | ✅ |
| attach_command() | ✅ | ✅ | ✅ | ✅ | ✅ |
| get_output() | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Configuration** |
| Config file loading | ✅ | ✅ | ✅ | ❌ | **GAP: Zellij** |
| Image configuration | ✅ | ✅ | ✅ | N/A | ✅ |
| Pull policy | ✅ | ✅ | ⚠️ Not explicit | N/A | **GAP: Apple** |
| Resource limits | ✅ | ✅ | ✅ | N/A | ✅ |
| Extra/custom flags | ✅ | ❌ | ❌ | N/A | **GAP: K8s, Apple** |
| **Caching** |
| Cargo cache volume | ✅ | ✅ | ✅ | N/A | ✅ |
| sccache volume | ✅ | ✅ | ✅ | N/A | ✅ |
| Cache dir pre-creation | ✅ | ❌ | ✅ | N/A | **GAP: K8s** |
| **Git Integration** |
| Worktree detection | ✅ | ❌ | ✅ | N/A | **GAP: K8s** |
| Git user config | ✅ | ✅ | ✅ | N/A | ✅ |
| Git config sanitization | ✅ | ✅ | ✅ | N/A | ✅ |
| Git remote detection | ❌ | ✅ | ❌ | N/A | (K8s-specific) |
| **Proxy Support** |
| HTTP/HTTPS proxy | ✅ | ✅ | ✅ | N/A | ✅ |
| CA certificate mount | ✅ | ✅ | ✅ | N/A | ✅ |
| Talosconfig | ✅ | ✅ | ✅ | N/A | ✅ |
| Codex config | ✅ | ✅ | ✅ | N/A | ✅ |
| Token placeholders | ✅ | ✅ | ✅ | N/A | ✅ |
| Proxy mode options | ✅ | ✅ (ClusterIP/HostGW) | ✅ | N/A | ✅ |
| **Plugin Support** |
| Plugin discovery | ✅ | ✅ | ✅ | ✅ (native) | ✅ |
| Plugin mounting | ✅ | ⚠️ Limited | ✅ | ✅ (native) | **GAP: K8s** |
| Plugin config generation | ✅ | ⚠️ Limited | ✅ | N/A | **GAP: K8s** |
| **Claude Config** |
| .claude.json creation | ✅ | ✅ (ConfigMap) | ✅ | N/A (host) | ✅ |
| Onboarding bypass | ✅ | ✅ | ✅ | N/A (host) | ✅ |
| Managed settings | ✅ | ❌ | ✅ | N/A | **GAP: K8s** |
| **Agent Support** |
| ClaudeCode | ✅ | ✅ | ✅ | ✅ | ✅ |
| Codex | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gemini | ✅ | ✅ | ✅ | ✅ | ✅ |
| Print mode | ✅ | ✅ | ✅ | ❌ | **GAP: Zellij** |
| Plan mode | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Session Management** |
| Session ID tracking | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session resume | ✅ | ❌ | ✅ | ⚠️ Limited | **GAP: K8s** |
| Fork session | ✅ | ❌ | ✅ | ❌ | **GAP: K8s, Zellij** |
| HTTP hook communication | ✅ | ✅ | ✅ | ❌ | **GAP: Zellij** |
| **Container Config** |
| User isolation | ✅ | ✅ | ✅ | N/A (host) | ✅ |
| Initial workdir | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload directory | ✅ | ✅ | ✅ | N/A (host) | ✅ |
| Host gateway | ✅ | ✅ | ⚠️ Different IP | N/A | (Platform diff) |
| **Security** |
| Image name validation | ✅ | ⚠️ Not explicit | ⚠️ Not explicit | N/A | **GAP: K8s, Apple** |
| Read-only mounts | ✅ | ✅ | ✅ | N/A | ✅ |
| Config validation | ✅ | ✅ | ✅ | N/A | ✅ |

## Critical Feature Gaps Identified

### 1. Kubernetes Backend Gaps

**Location**: `/workspace/packages/clauderon/src/backends/kubernetes.rs`

#### Missing Features:
1. **Git Worktree Support**: K8s uses git clone in init container, doesn't support worktree mounting like Docker
   - Impact: Users working with git worktrees lose that workflow
   - Complexity: High - would require mounting parent repo or alternative approach

2. **Plugin Mounting**: Plugins discovered but not mounted (warning logged)
   - Impact: Limited plugin functionality in K8s environments
   - Complexity: Medium - needs PersistentVolume approach
   - Current: Line 392 warns about limitation

3. **Session Resume Logic**: No wrapper script for session persistence across pod restarts
   - Impact: Sessions can't be resumed after pod deletion/restart
   - Complexity: Medium - needs similar wrapper logic to Docker

4. **Fork Session**: No `--fork-session` flag support
   - Impact: Can't create forked sessions in K8s
   - Complexity: Low - just add flag support

5. **Cache Directory Pre-creation**: Docker pre-creates cache dirs to avoid root ownership
   - Impact: Potential permission issues with PVCs
   - Complexity: Low - add similar directory creation logic

6. **Managed Settings**: No `managed-settings.json` for proxy environments
   - Impact: Bypass permissions mode not fully configured
   - Complexity: Low - add ConfigMap creation

7. **Image Name Validation**: No explicit validation like Docker
   - Impact: Potential security issue with command injection
   - Complexity: Low - reuse Docker's validation logic

8. **Extra Flags**: No support for custom pod/container flags
   - Impact: Advanced users can't customize pod configuration
   - Complexity: Medium - need to decide which K8s fields to expose

### 2. Apple Container Backend Gaps

**Location**: `/workspace/packages/clauderon/src/backends/apple_container.rs`

#### Missing Features:
1. **Pull Policy Configuration**: Image pull but no explicit policy like Docker
   - Impact: Can't control when images are pulled
   - Complexity: Low - add pull policy handling

2. **Image Name Validation**: No explicit validation
   - Impact: Potential security issue
   - Complexity: Low - reuse Docker's validation

3. **Extra Flags**: No custom flags support
   - Impact: Advanced users can't customize container
   - Complexity: Low - add extra_flags field to config

### 3. Zellij Backend Gaps

**Location**: `/workspace/packages/clauderon/src/backends/zellij.rs`

#### Missing Features (Expected):
1. **Configuration File**: No config file support
   - Impact: Can't customize Zellij behavior
   - Complexity: Low - but may not be necessary
   - Note: Zellij runs on host, most config not applicable

2. **Print Mode**: Explicitly not supported (always interactive)
   - Impact: Can't use non-interactive workflows
   - Complexity: High - fundamental limitation of Zellij
   - Note: Documented as known limitation (line 118)

3. **Fork Session**: No fork session support
   - Impact: Can't fork sessions
   - Complexity: Medium - would need session cloning logic

4. **HTTP Hook Communication**: No CLAUDERON_SESSION_ID/HTTP_PORT env vars
   - Impact: Hooks can't communicate with daemon via HTTP
   - Complexity: Medium - would need to pass env vars to Zellij panes

## Recommendations

### Priority 1: Critical Security Gaps
1. **Add image name validation** to Kubernetes and Apple Container backends
   - Reuse Docker's validation logic from line 262-263 of docker.rs
   - Prevents command injection attacks

### Priority 2: Feature Parity for Production Backends
2. **Kubernetes plugin mounting** via PersistentVolumes
   - Design: Create shared PVC for plugins, similar to cargo/sccache
   - Allows full plugin functionality in K8s

3. **Kubernetes session resume logic**
   - Implement wrapper script similar to Docker (lines 819-833 of docker.rs)
   - Enables session persistence across pod restarts

4. **Apple Container pull policy**
   - Add explicit pull policy handling
   - Ensures consistent image management

### Priority 3: Consistency & Completeness
5. **Kubernetes managed settings**
   - Add managed-settings.json ConfigMap
   - Complete proxy environment configuration

6. **Fork session support** for K8s and Zellij
   - K8s: Add `--fork-session` flag support
   - Zellij: Consider if needed or document limitation

7. **Extra flags support** for K8s and Apple Container
   - K8s: Expose pod/container customization options
   - Apple: Add extra_flags to config

8. **Zellij configuration file**
   - Evaluate if needed given host-based execution
   - Document as intentional omission if not needed

### Priority 4: Minor Improvements
9. **K8s cache directory pre-creation**
   - Prevent permission issues with PVCs
   - Low effort, improves reliability

10. **HTTP hook communication for Zellij**
    - Enable daemon communication from host sessions
    - Medium effort, enhances integration

## Implementation Notes

### Verification Steps
After implementing any gaps:
1. Run backend-specific tests: `cd packages/clauderon && cargo test backends::<backend_name>`
2. Integration test with clauderon CLI: Create, attach, delete session
3. Test with proxy enabled and disabled
4. Test with all agent types (ClaudeCode, Codex, Gemini)
5. Test resource limits and custom configurations
6. Verify security: test git config sanitization, image validation

### Critical Files
- Docker backend: `/workspace/packages/clauderon/src/backends/docker.rs` (baseline)
- Kubernetes backend: `/workspace/packages/clauderon/src/backends/kubernetes.rs`
- Apple Container: `/workspace/packages/clauderon/src/backends/apple_container.rs`
- Zellij: `/workspace/packages/clauderon/src/backends/zellij.rs`
- Trait definitions: `/workspace/packages/clauderon/src/backends/traits.rs`
- Container config: `/workspace/packages/clauderon/src/backends/container_config.rs`

### Non-Goals (Intentional Differences)
- **Zellij print mode**: Documented limitation, not a bug
- **K8s git worktree**: Different git model (clone vs mount), not necessarily a gap
- **Platform-specific features**: Host gateway IPs differ by platform (expected)

## Summary

This audit identified **10 critical gaps** across the backend implementations:
- **Kubernetes**: 8 gaps (plugin mounting, session resume, worktree support, etc.)
- **Apple Container**: 3 gaps (pull policy, validation, extra flags)
- **Zellij**: 4 gaps (mostly expected limitations for host-based execution)

The highest priority items are security-related (image validation) and production-critical features (K8s plugin support, session resume). Most gaps are low-to-medium complexity and can be addressed by reusing Docker's implementation patterns.
