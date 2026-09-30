# Spike container: Bun for our scripts, Node for the Claude Code CLI the agent
# SDK spawns. Session state lives under /session-home (hydrated per run).
FROM oven/bun:1.2-debian

RUN apt-get update && apt-get install -y --no-install-recommends nodejs ripgrep ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN bun install

COPY src ./src

# Claude Code's --dangerously-skip-permissions (permissionMode:bypassPermissions)
# refuses to run as root, so the agent runs as a non-root uid — matching the
# production plan's isolation intent.
RUN useradd -u 1001 -m agent \
  && mkdir -p /session-home/home /session-home/codex-home /work /out \
  && chown -R agent:agent /session-home /work /out /app
USER agent

ENV HOME=/session-home/home
ENV CODEX_HOME=/session-home/codex-home

ENTRYPOINT ["bun", "src/container-main.ts"]
