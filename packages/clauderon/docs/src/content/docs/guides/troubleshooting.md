---
title: Troubleshooting
description: Common issues and solutions for clauderon
---

This guide covers common issues and their solutions.

## Daemon Issues

### Daemon Won't Start

**Symptom:** `clauderon daemon` exits immediately or errors.

**Solutions:**

1. Check for existing daemon:

   ```bash
   pgrep clauderon
   ```

2. Check if port is in use:

   ```bash
   lsof -i :3030
   ```

3. Check logs:

   ```bash
   RUST_LOG=clauderon=debug clauderon daemon
   ```

4. Reset state:
   ```bash
   rm ~/.clauderon/db.sqlite
   clauderon daemon
   ```

### Can't Connect to Daemon

**Symptom:** CLI commands fail with connection errors.

**Solutions:**

1. Verify daemon is running:

   ```bash
   curl http://localhost:3030/health
   ```

2. Check daemon logs for errors.

3. Restart daemon:
   ```bash
   pkill clauderon
   clauderon daemon
   ```

## Session Issues

### Session Won't Create

**Symptom:** `clauderon create` fails or hangs.

**Solutions:**

1. Check backend requirements:
   - Zellij: `zellij --version`
   - Docker: `docker info`

2. Check repository path exists:

   ```bash
   ls -la ~/your/project
   ```

3. Check disk space:

   ```bash
   df -h ~/.clauderon
   ```

4. Try with verbose logging:
   ```bash
   RUST_LOG=clauderon=debug clauderon create --repo ~/project --prompt "test"
   ```

### Session Not Appearing

**Symptom:** Session created but not in list.

**Solutions:**

1. Check with archived:

   ```bash
   clauderon list --archived
   ```

2. Reconcile database:

   ```bash
   clauderon reconcile
   ```

3. Check database:
   ```bash
   sqlite3 ~/.clauderon/db.sqlite "SELECT * FROM sessions"
   ```

### Can't Attach to Session

**Symptom:** `clauderon attach` fails.

**Solutions:**

1. Check session exists:

   ```bash
   clauderon list
   ```

2. Check backend status:

   ```bash
   # For Zellij
   zellij list-sessions

   # For Docker
   docker ps -a | grep clauderon
   ```

3. Reconcile if needed:
   ```bash
   clauderon reconcile
   ```

## Proxy Issues

### Credentials Not Injecting

**Symptom:** Agent gets 401/403 errors.

**Solutions:**

1. Check credential status:

   ```bash
   clauderon config credentials
   ```

2. Verify secret files exist:

   ```bash
   ls -la ~/.clauderon/secrets/
   ```

3. Check file permissions:

   ```bash
   chmod 600 ~/.clauderon/secrets/*
   ```

4. Check audit log:

   ```bash
   tail ~/.clauderon/audit.jsonl | jq
   ```

5. Test credential directly:
   ```bash
   curl -H "Authorization: Bearer $(cat ~/.clauderon/secrets/github_token)" \
     https://api.github.com/user
   ```

### Certificate Errors

**Symptom:** SSL/TLS certificate verification fails.

**Solutions:**

1. Regenerate CA:

   ```bash
   rm ~/.clauderon/proxy-ca.pem ~/.clauderon/proxy-ca-key.pem
   clauderon daemon
   ```

2. Check certificate is mounted (Docker):

   ```bash
   docker exec <container> cat /etc/clauderon/proxy-ca.pem
   ```

3. Check environment variables in session:
   ```bash
   echo $SSL_CERT_FILE
   echo $NODE_EXTRA_CA_CERTS
   ```

### Requests Being Blocked

**Symptom:** Requests fail with 403 in read-only mode.

**Solutions:**

1. Check access mode:

   ```bash
   clauderon list
   ```

2. Change to read-write if needed:

   ```bash
   clauderon set-access-mode <session> read-write
   ```

3. Check audit log for blocked requests:
   ```bash
   jq 'select(.allowed == false)' ~/.clauderon/audit.jsonl
   ```

## Docker Backend Issues

### Container Won't Start

**Symptom:** Docker session creation fails.

**Solutions:**

1. Check Docker is running:

   ```bash
   docker info
   ```

2. Check user is in docker group:

   ```bash
   groups | grep docker
   ```

3. Pull image manually:

   ```bash
   docker pull ghcr.io/anthropics/claude-code:latest
   ```

4. Check disk space:
   ```bash
   docker system df
   ```

### Container Network Issues

**Symptom:** Container can't reach proxy.

**Solutions:**

1. Test from container:

   ```bash
   docker exec <container> curl http://host.docker.internal:3030/health
   ```

2. Check Docker network mode.

3. Verify proxy is accessible from host.

### Out of Disk Space

**Symptom:** Docker operations fail with no space.

**Solutions:**

1. Check Docker disk usage:

   ```bash
   docker system df
   ```

2. Clean up:

   ```bash
   docker system prune -a
   ```

3. Clean clauderon cache:
   ```bash
   clauderon clean-cache --force
   ```

## Zellij Backend Issues

### Zellij Session Not Found

**Symptom:** Can't attach, session shows as missing.

**Solutions:**

1. List Zellij sessions:

   ```bash
   zellij list-sessions
   ```

2. Kill orphaned sessions:

   ```bash
   zellij kill-session <name>
   ```

3. Reconcile:
   ```bash
   clauderon reconcile
   ```

### Environment Variables Not Set

**Symptom:** Proxy variables missing in Zellij session.

**Solutions:**

1. Verify daemon was running when session was created.

2. Delete and recreate session:
   ```bash
   clauderon delete <session>
   clauderon create --repo ~/project --prompt "task"
   ```

## 1Password Issues

### 1Password CLI Not Found

**Symptom:** Error about `op` command not found.

**Solutions:**

1. Install 1Password CLI:

   ```bash
   brew install 1password-cli
   ```

2. Verify installation:

   ```bash
   op --version
   ```

3. Specify path in config:
   ```toml
   [onepassword]
   op_path = "/usr/local/bin/op"
   ```

### 1Password Not Signed In

**Symptom:** Credentials not loading from 1Password.

**Solutions:**

1. Sign in:

   ```bash
   op signin
   ```

2. For service accounts:

   ```bash
   export OP_SERVICE_ACCOUNT_TOKEN="your-token"
   ```

3. Test access:
   ```bash
   op vault list
   ```

### Item Not Found

**Symptom:** 1Password reference fails.

**Solutions:**

1. Verify reference format: `op://Vault/Item/Field`

2. Test reference:

   ```bash
   op read "op://Vault/Item/Field"
   ```

3. Check vault and item names match exactly.

## Performance Issues

### Slow Session Startup

**Solutions:**

1. Use Zellij for faster startup.

2. For Docker, use `--pull-policy never` with cached images.

3. Check disk I/O.

### High Memory Usage

**Solutions:**

1. Check for many active sessions:

   ```bash
   clauderon list | wc -l
   ```

2. Archive old sessions:

   ```bash
   clauderon archive <session>
   ```

3. Restart daemon to clear memory.

### Slow Web UI

**Solutions:**

1. Archive old sessions with large chat histories.

2. Clear browser cache.

3. Check WebSocket connection status.

## Getting Help

If these solutions don't help:

1. Check logs with debug level:

   ```bash
   RUST_LOG=clauderon=debug clauderon daemon
   ```

2. Report issues at [GitHub Issues](https://github.com/shepherdjerred/monorepo/issues)

3. Include:
   - clauderon version
   - Operating system
   - Backend type
   - Error messages
   - Relevant logs

## See Also

- [Installation](/getting-started/installation/) - Setup guide
- [Configuration Reference](/reference/configuration/) - Config options
- [Docker Backend](/guides/docker/) - Docker-specific guide
- [Zellij Backend](/guides/zellij/) - Zellij-specific guide
