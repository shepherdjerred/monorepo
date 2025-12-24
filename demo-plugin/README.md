# Demo Plugin

A comprehensive DevOps, Observability, and Development Workflow plugin providing CLI guidance, coding best practices, and automated workflows for modern development teams.

## What's Included

This plugin includes:

- **Slash Command**: `/demo-plugin:hype` - Get encouraging messages for your coding session
- **16 Specialized Agents** - Automatically activate to help with specific tools and workflows

### Agents

#### Secrets & Auth
- **1Password Helper** (`op-helper`) - Secure secret retrieval with `op` CLI, secret references, and service accounts
- **GitHub CLI Helper** (`gh-helper`) - PR management, issues, workflows, and repository operations with `gh`

#### Kubernetes Ecosystem
- **Kubernetes Helper** (`kubectl-helper`) - Cluster troubleshooting, resource management, and debugging with `kubectl`
- **Talos Helper** (`talos-helper`) - Talos Linux cluster administration with `talosctl`

#### CI/CD & GitOps
- **Dagger Helper** (`dagger-helper`) - CI/CD pipeline development with Dagger SDK
- **ArgoCD Helper** (`argocd-helper`) - GitOps deployment management and application sync

#### Observability
- **Sentry Helper** (`sentry-helper`) - Error tracking with `sentry-cli` and Sentry API
- **PagerDuty Helper** (`pagerduty-helper`) - Incident management with PagerDuty API
- **Grafana Helper** (`grafana-helper`) - Metrics, dashboards, and observability with Grafana API

#### Development
- **TypeScript Helper** (`typescript-helper`) - Type system guidance, error resolution, and tooling
- **Code Explainer** (`code-explainer`) - Beginner-friendly code explanations

#### Development Best Practices
- **Type-Safe Development** (`type-safe-development`) - Zod-first validation patterns and strict TypeScript
- **Bun Runtime Best Practices** (`bun-runtime-best-practices`) - Modern Bun APIs over Node.js equivalents
- **Modern CLI Tools** (`modern-cli-tools`) - Modern Unix command alternatives (fd, rg, exa, bat, etc.)

#### Workflow Automation
- **PR Workflow Automation** (`pr-workflow-automation`) - Automated PR creation with CI monitoring and retry logic
- **Worktree Workflow** (`worktree-workflow`) - Git worktree-based development for isolated changes

## How to Use

### Install the Plugin

Run Claude Code with this plugin:

```bash
claude --plugin-dir ./demo-plugin
```

### Try the Slash Command

Once Claude Code is running, try:

```shell
/demo-plugin:hype
```

Or with a topic:

```shell
/demo-plugin:hype debugging
```

### Agents Activate Automatically

Agents automatically activate when you work with their respective tools:

**Secrets & Auth**
- **1Password** - Activates when you mention: 1Password, secrets, `op` command, credentials
- **GitHub** - Activates when you mention: GitHub, pull requests, `gh` command, repositories

**Kubernetes Ecosystem**
- **Kubernetes** - Activates when you: work with K8s, mention `kubectl`, pods, deployments, errors
- **Talos** - Activates when you mention: Talos, `talosctl`, cluster operations

**CI/CD & GitOps**
- **Dagger** - Activates when you: work with Dagger, mention CI/CD pipelines, `dagger` commands
- **ArgoCD** - Activates when you mention: ArgoCD, GitOps, application sync, `argocd` commands

**Observability**
- **Sentry** - Activates when you mention: Sentry, error tracking, issues, share Sentry URLs
- **PagerDuty** - Activates when you mention: PagerDuty, incidents, on-call, pages, escalations
- **Grafana** - Activates when you mention: Grafana, metrics, dashboards, PromQL, LogQL

**Development**
- **TypeScript** - Activates when you: work with `.ts`/`.tsx` files, mention TypeScript, encounter type errors
- **Code Explainer** - Activates when you ask: "explain this code", "what does this do"

**Development Best Practices**
- **Type-Safe Development** - Activates when you: write TypeScript code, encounter type errors, need runtime validation, or mention Zod
- **Bun Runtime** - Activates when you: use file I/O, environment variables, spawn processes, or mention Node.js APIs
- **Modern CLI Tools** - Activates when: Claude is about to use legacy tools (find, grep, ls, cat) OR you mention fd, rg, eza, bat

**Workflow Automation**
- **PR Workflow** - Activates when you: create PRs, need CI monitoring, mention GitHub Actions workflows
- **Worktree Workflow** - Activates when you: start new work, switch contexts, need parallel development, or mention Git worktrees

### Example Usage

```
You: "How do I retrieve a database password from 1Password?"
→ 1Password Helper activates and provides op CLI guidance

You: "I need to check the logs for this failing pod"
→ Kubernetes Helper activates with kubectl debugging commands

You: "How do I create a PR with gh?"
→ GitHub CLI Helper activates with PR creation workflow

You: "This TypeScript error is confusing"
→ TypeScript Helper activates with type error solutions

You: "I want to validate this API response at runtime"
→ Type-Safe Development agent shows Zod schema patterns

You: "How do I read a file in Bun?"
→ Bun Runtime agent teaches Bun.file() over fs module

You: "What's faster than grep for searching code?"
→ Modern CLI Tools agent recommends ripgrep (rg)

You: "Create a PR and wait for CI to pass"
→ PR Workflow Automation agent handles the complete workflow

You: "I need to start working on a new feature"
→ Worktree Workflow agent guides you through git worktree setup
```

## Plugin Structure

```
demo-plugin/
├── .claude-plugin/
│   └── plugin.json                      # Plugin manifest
├── commands/
│   └── hype.md                          # Slash command
├── agents/
│   # Secrets & Auth
│   ├── op-helper.md                     # 1Password CLI helper
│   ├── gh-helper.md                     # GitHub CLI helper
│   # Kubernetes Ecosystem
│   ├── kubectl-helper.md                # Kubernetes helper
│   ├── talos-helper.md                  # Talos Linux helper
│   # CI/CD & GitOps
│   ├── dagger-helper.md                 # Dagger CI/CD helper
│   ├── argocd-helper.md                 # ArgoCD GitOps helper
│   # Observability
│   ├── sentry-helper.md                 # Sentry error tracking helper
│   ├── pagerduty-helper.md              # PagerDuty incident helper
│   ├── grafana-helper.md                # Grafana observability helper
│   # Development
│   ├── typescript-helper.md             # TypeScript development helper
│   ├── code-explainer.md                # Code explanation agent
│   # Development Best Practices
│   ├── type-safe-development.md         # Zod-first validation patterns
│   ├── bun-runtime-best-practices.md    # Bun APIs over Node.js
│   ├── modern-cli-tools.md              # Modern Unix alternatives
│   # Workflow Automation
│   ├── pr-workflow-automation.md        # Automated PR with CI monitoring
│   └── worktree-workflow.md             # Git worktree development
└── README.md                            # This file
```

## CLI Tool Installation

The agents provide guidance for these CLI tools. Install the ones you need:

**1Password CLI**
```bash
brew install --cask 1password-cli  # macOS
```

**GitHub CLI**
```bash
brew install gh  # macOS
```

**Dagger**
```bash
brew install dagger/tap/dagger  # macOS
```

**kubectl**
```bash
brew install kubectl  # macOS
```

**Talos CLI**
```bash
brew install siderolabs/tap/talosctl  # macOS
```

**Sentry CLI**
```bash
brew install getsentry/tools/sentry-cli  # macOS
npm install -g @sentry/cli  # npm
```

**ArgoCD CLI**
```bash
brew install argocd  # macOS
```

**TypeScript**
```bash
npm install -g typescript  # npm
bun add -g typescript  # bun
```

**Bun Runtime**
```bash
curl -fsSL https://bun.sh/install | bash  # macOS/Linux
brew install bun  # macOS (via Homebrew)
```

**Modern CLI Tools**
```bash
brew install fd ripgrep eza bat fzf sd zoxide  # macOS
```

For PagerDuty and Grafana, the agents teach API usage with `curl` - no special CLI installation required.

## What Each Agent Provides

Each agent offers:

- **Auto-Approved Commands** - Safe commands that run without confirmation (for `op`, `gh`, `kubectl`)
- **Command Patterns** - Common CLI usage patterns and workflows
- **Best Practices** - Security considerations and recommended approaches
- **Troubleshooting** - Common issues and their solutions
- **Examples** - Real-world usage scenarios
- **API Integration** - curl/API patterns for tools without robust CLIs

## Features

✅ **CLI-First Approach** - Focus on command-line tools and bash workflows
✅ **Auto-Approved Commands** - Pre-approved safe commands for faster workflows
✅ **Practical Examples** - Real-world scenarios and solutions
✅ **Best Practices** - Security and operational guidance
✅ **Troubleshooting Help** - Common issues and resolutions
✅ **Tool Installation Guidance** - Setup instructions for all tools
✅ **Development Best Practices** - Zod-first validation and Bun runtime patterns
✅ **Workflow Automation** - Automated PR workflows and Git worktree management
✅ **Modern CLI Tools** - Faster alternatives to traditional Unix commands

## Workflow Automation Highlights

### PR Workflow Automation

Automate your entire pull request workflow:

```bash
# Push changes, create PR, monitor CI, and auto-fix failures
./pr-auto-fix.sh

# The agent handles:
# 1. Push to remote branch
# 2. Create pull request
# 3. Monitor CI status
# 4. On failure: Auto-fix lint/format issues
# 5. Amend and retry until CI passes
```

**Features:**
- Automatic CI monitoring with status polling
- Auto-fix for linting and formatting failures
- Intelligent retry logic with backoff
- Force-push safety with `--force-with-lease`
- Detailed failure logs and debugging

### Git Worktree Workflow

Isolate work in separate directories without branch switching:

```bash
# Start new feature in dedicated worktree
git worktree add ../feature-auth -b feature/auth

# Work independently on multiple features
cd ../feature-auth      # Work on auth
cd ../feature-api       # Switch to API
cd ../feature-docs      # Switch to docs

# Create PR when ready
gh pr create --fill

# Clean up after merge
git worktree remove ../feature-auth
```

**Benefits:**
- Parallel development without branch switching
- Isolated dependencies and build artifacts
- Clean context switching
- No uncommitted work blocking you

## Contributing

This plugin demonstrates comprehensive DevOps tool support. You can extend it by:

- Adding more agents for other tools (Terraform, Ansible, etc.)
- Creating specialized commands for common workflows
- Adding hooks for automation
- Contributing improvements to existing agents

Check out the [Plugin Documentation](https://code.claude.com/docs/en/plugins.md) for more details on building Claude Code plugins.
