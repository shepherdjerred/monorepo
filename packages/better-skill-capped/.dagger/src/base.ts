import { dag, Container } from "@dagger.io/dagger";

/**
 * Get a base Bun container
 * @returns A Bun container with basic setup
 */
export function getBunContainer(): Container {
  return dag.container().from("oven/bun:latest").withWorkdir("/workspace");
}

/**
 * Get a Bun container with Node.js support
 * @returns A Bun container with Node.js installed
 */
export function getBunNodeContainer(): Container {
  return dag
    .container()
    .from("oven/bun:latest")
    .withWorkdir("/workspace")
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "curl", "ca-certificates", "gnupg"])
    .withExec(["mkdir", "-p", "/etc/apt/keyrings"])
    .withExec([
      "sh",
      "-c",
      "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg",
    ])
    .withExec([
      "sh",
      "-c",
      'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list',
    ])
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "nodejs"])
    .withExec(["npm", "install", "-g", "npm"]);
}

/**
 * Get a system container (Ubuntu) with basic tools
 * @returns An Ubuntu container with basic tools
 */
export function getSystemContainer(): Container {
  return dag.container().from("ubuntu:jammy").withWorkdir("/workspace");
}

/**
 * Get a container with GitHub CLI installed
 * @returns A container with GitHub CLI for deployment tasks
 */
export function getGitHubContainer(): Container {
  const ghVersion = "2.63.2";
  return dag
    .container()
    .from("ubuntu:noble")
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "git", "curl"])
    .withExec([
      "sh",
      "-c",
      `curl -L -o ghcli.deb https://github.com/cli/cli/releases/download/v${ghVersion}/gh_${ghVersion}_linux_amd64.deb`,
    ])
    .withExec(["dpkg", "-i", "ghcli.deb"])
    .withExec(["rm", "ghcli.deb"])
    .withExec(["git", "config", "--global", "user.name", "scout-for-lol"])
    .withExec(["git", "config", "--global", "user.email", "github@sjer.red"])
    .withWorkdir("/workspace");
}
