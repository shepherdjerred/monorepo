# AI Agent Workflows (2025)

## The incident.io Case Study

**Real-world example**: incident.io runs **4-5 Claude Code agents in parallel** using worktrees, enabling multiple AI agents to work on different features simultaneously without conflicts.

**Key benefits**:

- **Complete isolation**: Each agent operates in its own worktree with its own branch and file state
- **No cross-contamination**: Agents can't accidentally modify files from other agents' work
- **Parallel execution**: 4-5 features developed concurrently by autonomous agents
- **Clean git history**: Each agent creates focused, single-purpose PRs
- **Zero coordination overhead**: No need to orchestrate agent work order

## Structured Directory Organization for AI Agents

```bash
# Organized worktree structure for AI agent workflows
project/
├── .git/                          # Shared git repository
├── main/                          # Main development worktree
└── worktrees/
    ├── feature/
    │   ├── agent-1-auth/          # Claude agent working on authentication
    │   ├── agent-2-api/           # Claude agent building API endpoints
    │   └── agent-3-ui/            # Claude agent creating UI components
    ├── bugfix/
    │   ├── agent-4-login-fix/     # Claude agent fixing login bug
    │   └── agent-5-perf/          # Claude agent optimizing performance
    └── review/
        └── human-review-pr-123/   # Human reviewing AI-generated PR
```

## Setting Up AI Agent Worktrees

```bash
#!/bin/bash
# setup-ai-agent-worktree.sh <agent-id> <task-type> <task-name>
# Usage: setup-ai-agent-worktree.sh agent-1 feature authentication

set -euo pipefail

AGENT_ID=${1:?Usage: setup-ai-agent-worktree.sh <agent-id> <task-type> <task-name>}
TASK_TYPE=${2:?Usage: setup-ai-agent-worktree.sh <agent-id> <task-type> <task-name>}
TASK_NAME=${3:?Usage: setup-ai-agent-worktree.sh <agent-id> <task-type> <task-name>}

REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_BASE="$REPO_ROOT/worktrees"
TASK_DIR="$WORKTREE_BASE/$TASK_TYPE/$AGENT_ID-$TASK_NAME"
BRANCH_NAME="$TASK_TYPE/$TASK_NAME"

echo "Setting up AI agent worktree"
echo "   Agent: $AGENT_ID"
echo "   Task: $TASK_TYPE/$TASK_NAME"
echo "   Path: $TASK_DIR"

# Create organized directory structure
mkdir -p "$WORKTREE_BASE/$TASK_TYPE"

# Fetch latest changes
git fetch origin

# Create worktree for agent
git worktree add -b "$BRANCH_NAME" "$TASK_DIR" origin/main

echo "AI agent worktree ready!"
echo ""
echo "Next steps:"
echo "  1. Navigate: cd $TASK_DIR"
echo "  2. Agent starts working in isolated environment"
echo "  3. Agent commits: git commit -m 'feat: ...'"
echo "  4. Agent creates PR: gh pr create --fill"
```

## AI Agent Isolation Benefits

**Complete isolation prevents**:

- Agent A modifying Agent B's files
- Merge conflicts between parallel agent work
- Branch checkout race conditions
- Uncommitted changes interfering with other agents
- Accidental deletion of other agents' work

**Example scenario** (4 parallel agents):

```bash
# Agent 1: Authentication feature
cd worktrees/feature/agent-1-auth/
# Works on: src/auth/*.ts

# Agent 2: API endpoints
cd worktrees/feature/agent-2-api/
# Works on: src/api/*.ts

# Agent 3: UI components
cd worktrees/feature/agent-3-ui/
# Works on: src/components/*.tsx

# Agent 4: Database migrations
cd worktrees/feature/agent-4-db/
# Works on: prisma/migrations/*.sql

# All 4 agents operate independently without conflicts!
```

## Emergency Hotfix with AI Agent (No Main Disruption)

```bash
# Production bug discovered while agents work on features
# Create emergency hotfix worktree without disrupting main development

# Agent 5: Emergency hotfix
git worktree add worktrees/bugfix/agent-5-hotfix -b hotfix/critical-bug release/v1.0

cd worktrees/bugfix/agent-5-hotfix/

# Agent makes critical fix
echo "fix" > critical-fix.ts
git add critical-fix.ts
git commit -m "fix: critical production bug"
git push -u origin hotfix/critical-bug

# Create hotfix PR targeting release branch
gh pr create --base release/v1.0 --title "fix: critical bug" --fill

# Main worktree and other agent worktrees continue unaffected!
```

## Cleanup After AI Agent Completion

```bash
#!/bin/bash
# cleanup-ai-agent-worktree.sh <agent-id> <task-type> <task-name>

set -euo pipefail

AGENT_ID=${1:?}
TASK_TYPE=${2:?}
TASK_NAME=${3:?}

REPO_ROOT=$(git rev-parse --show-toplevel)
TASK_DIR="$REPO_ROOT/worktrees/$TASK_TYPE/$AGENT_ID-$TASK_NAME"
BRANCH_NAME="$TASK_TYPE/$TASK_NAME"

echo "Cleaning up AI agent worktree: $AGENT_ID"

# Check if PR is merged
if gh pr view "$BRANCH_NAME" --json state --jq .state 2>/dev/null | grep -q "MERGED"; then
  echo "PR merged, cleaning up..."

  # Remove worktree
  git worktree remove "$TASK_DIR" 2>/dev/null || {
    echo "Worktree already removed or has uncommitted changes"
    git worktree remove --force "$TASK_DIR"
  }

  # Delete local branch
  git branch -d "$BRANCH_NAME" 2>/dev/null || {
    echo "Force deleting branch"
    git branch -D "$BRANCH_NAME"
  }

  # Delete remote branch
  git push origin --delete "$BRANCH_NAME" 2>/dev/null || {
    echo "Remote branch already deleted"
  }

  echo "Cleanup complete for $AGENT_ID"
else
  echo "PR not merged yet"
  gh pr view "$BRANCH_NAME"
  exit 1
fi
```

## Best Practices for AI Agent Workflows

1. **Meaningful Directory Names**: Use descriptive names like `agent-1-auth` instead of `agent-1` or `temp-worktree`

   ```bash
   # Good - clear what agent is working on
   worktrees/feature/agent-1-authentication/
   worktrees/feature/agent-2-api-endpoints/

   # Bad - unclear purpose
   worktrees/feature/agent-1/
   worktrees/feature/temp/
   ```

2. **Structured Categories**: Organize by task type (feature/bugfix/review)

   ```bash
   worktrees/
   ├── feature/    # New capabilities
   ├── bugfix/     # Bug fixes
   ├── refactor/   # Code improvements
   ├── docs/       # Documentation
   └── review/     # Human review of AI work
   ```

3. **Agent Coordination**: Use clear branch naming for visibility

   ```bash
   # Agent creates branch with clear prefix
   feature/add-authentication      # Agent 1
   feature/add-api-endpoints       # Agent 2
   bugfix/fix-login-validation     # Agent 3
   ```

4. **Automatic Cleanup**: Run cleanup scripts after PR merge

   ```bash
   # In CI/CD after merge
   cleanup-ai-agent-worktree.sh agent-1 feature authentication
   ```

5. **Monitoring**: Track active agent worktrees
   ```bash
   # List all active AI agent worktrees
   git worktree list | grep "agent-"
   ```
