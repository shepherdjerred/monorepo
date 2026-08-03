export const HELP = `Usage:
  bun run pr:fleet --model <provider>/<model> [options]

Options:
  --repo <owner/name>       Repository (default: shepherdjerred/monorepo)
  --checkout <path>         Main checkout (default: current Git root)
  --worktree-root <path>    Fleet worktrees (default: .claude/worktrees/pr-fleet)
  --max-workers <1..5>      Worker limit (default: 5)
  --base-url <url>          Required for openai-compatible/<model>
  --api-key-env <name>      API-key environment variable for a compatible endpoint
  --review-provider <id>    Hosted review provider to gate on (default: codex)
  --state-dir <path>        Local run-bundle root (default: XDG state directory)
  --help                    Show this help

Interactive commands:
  /status  /tick  /help  /stop
  Any other line is queued conversational steering for the master.`;
