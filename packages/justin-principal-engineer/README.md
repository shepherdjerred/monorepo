# justin-principal-engineer

Local macOS automation that turns a labeled Linear issue into a reviewed,
owner-approved pull request.

The CLI is intentionally one-shot. `launchd` starts `reconcile` every minute;
each invocation advances one durable task and exits. Coding turns run through
the native Claude Agent SDK or Codex SDK inside Docker. GitHub App credentials,
CI access, commits, pull requests, evidence uploads, approvals, and
merges stay on the host.

## Commands

| Command            | Effect                                             |
| ------------------ | -------------------------------------------------- |
| `doctor`           | Verify tools, Docker, labels, credentials, and App |
| `reconcile`        | Advance one queue or task transition               |
| `daemon install`   | Install and load the 60-second LaunchAgent         |
| `daemon start`     | Load or immediately kick the LaunchAgent           |
| `daemon stop`      | Unload it without deleting state                   |
| `daemon status`    | Show service and task states                       |
| `daemon uninstall` | Unload and remove the plist; preserve task state   |

Runtime files live under
`~/Library/Application Support/justin-principal-engineer`. The configuration
contract is in `config.example.json`.

## Development

```bash
bunx turbo run build typecheck test lint \
  --filter=@shepherdjerred/justin-principal-engineer
```

See [Run the Linear agent queue](../docs/wiki/src/content/docs/how-to/run-the-linear-agent-queue.md)
for setup and operation.
