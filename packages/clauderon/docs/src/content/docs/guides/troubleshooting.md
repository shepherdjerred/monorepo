---
title: Troubleshooting
description: Common issues and solutions for clauderon
---

## Daemon Issues

### Daemon Won't Start

```bash
pgrep clauderon                           # check for existing daemon
lsof -i :3030                             # check port in use
RUST_LOG=clauderon=debug clauderon daemon  # verbose logging
rm ~/.clauderon/db.sqlite && clauderon daemon  # reset state
```

### Can't Connect to Daemon

```bash
curl http://localhost:3030/health          # verify daemon running
pkill clauderon && clauderon daemon        # restart
```

## Session Issues

### Session Won't Create

```bash
zellij --version           # check Zellij
docker info                # check Docker
df -h ~/.clauderon         # check disk space
RUST_LOG=clauderon=debug clauderon create --repo ~/project --prompt "test"
```

### Session Not Appearing

```bash
clauderon list --archived                                  # check archived
clauderon reconcile                                        # reconcile database
sqlite3 ~/.clauderon/db.sqlite "SELECT * FROM sessions"    # inspect DB
```

### Can't Attach to Session

```bash
clauderon list
zellij list-sessions       # Zellij backend
docker ps -a | grep clauderon  # Docker backend
clauderon reconcile
```

## Proxy Issues

### Credentials Not Injecting

```bash
clauderon config credentials                    # check status
ls -la ~/.clauderon/secrets/                     # verify files exist
chmod 600 ~/.clauderon/secrets/*                 # fix permissions
tail ~/.clauderon/audit.jsonl | jq               # check audit log
curl -H "Authorization: Bearer $(cat ~/.clauderon/secrets/github_token)" \
  https://api.github.com/user                    # test directly
```

### Certificate Errors

```bash
rm ~/.clauderon/proxy-ca.pem ~/.clauderon/proxy-ca-key.pem  # regenerate CA
clauderon daemon
docker exec <container> cat /etc/clauderon/proxy-ca.pem      # verify mounted
```

### Requests Blocked (403 in read-only)

```bash
clauderon list                                              # check access mode
clauderon set-access-mode <session> read-write              # change mode
jq 'select(.allowed == false)' ~/.clauderon/audit.jsonl     # check blocked
```

## Docker Backend

### Container Won't Start

```bash
docker info                                          # Docker running?
groups | grep docker                                 # in docker group?
docker pull ghcr.io/anthropics/claude-code:latest    # pull image
docker system df                                     # disk space
```

### Container Network Issues

```bash
docker exec <container> curl http://host.docker.internal:3030/health
```

### Out of Disk Space

```bash
docker system df
docker system prune -a
clauderon clean-cache --force
```

## Zellij Backend

### Session Not Found

```bash
zellij list-sessions
zellij kill-session <name>    # kill orphaned
clauderon reconcile
```

### Environment Variables Missing

Delete and recreate session (daemon must be running during creation).

## 1Password Issues

| Problem        | Solution                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| `op` not found | `brew install 1password-cli`                                                    |
| Not signed in  | `op signin` or `export OP_SERVICE_ACCOUNT_TOKEN="..."`                          |
| Item not found | Verify format: `op://Vault/Item/Field`; test: `op read "op://Vault/Item/Field"` |

## Performance Issues

| Problem      | Solution                                                        |
| ------------ | --------------------------------------------------------------- |
| Slow startup | Use Zellij; Docker: `--pull-policy never` with cached images    |
| High memory  | Archive old sessions; restart daemon                            |
| Slow Web UI  | Archive sessions with large chat histories; clear browser cache |

## Getting Help

```bash
RUST_LOG=clauderon=debug clauderon daemon
```

Report issues at [GitHub Issues](https://github.com/shepherdjerred/monorepo/issues) with: clauderon version, OS, backend type, error messages, relevant logs.
