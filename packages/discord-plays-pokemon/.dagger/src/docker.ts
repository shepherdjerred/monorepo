import { Directory, Container, Secret, dag } from "@dagger.io/dagger";
import { getBackendWithDeps } from "./backend";
import { getFrontendBuild } from "./frontend";

/**
 * Build the Discord Plays Pokemon Docker image
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @returns The built container
 */
export async function buildDockerImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Promise<Container> {
  // Get the built backend and frontend
  const backendDir = await getBackendWithDeps(workspaceSource);
  const frontendDist = await getFrontendBuild(workspaceSource);

  // Standard PATH for Ubuntu/Debian systems
  const standardPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

  return dag
    .container()
    .from("ghcr.io/selkies-project/nvidia-egl-desktop:24.04-20241222100454")
    .withoutEntrypoint()
    .withEnvVariable("PATH", standardPath)
    .withEnvVariable("DEBIAN_FRONTEND", "noninteractive")
    .withUser("root")
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "curl", "kde-config-screenlocker", "unzip"])
    .withExec(["sh", "-c", "curl -fsSL https://bun.sh/install | bash"])
    .withEnvVariable("PATH", `/root/.bun/bin:/home/ubuntu/.bun/bin:${standardPath}`)
    .withWorkdir("/home/ubuntu")
    .withExec(["mkdir", "-p", "data"])
    .withFile("/tmp/supervisord.conf", workspaceSource.file("misc/supervisord.conf"))
    .withExec(["sh", "-c", "cat /tmp/supervisord.conf >> /etc/supervisord.conf && rm /tmp/supervisord.conf"])
    .withFile("package.json", backendDir.file("package.json"))
    .withFile("bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("packages/backend", backendDir)
    .withDirectory("packages/frontend", frontendDist)
    .withFile("run.sh", workspaceSource.file("misc/run.sh"))
    .withExec(["mkdir", "-p", "Downloads"])
    .withExec(["chown", "-R", "ubuntu:ubuntu", "/home/ubuntu"])
    .withUser("ubuntu")
    .withExec(["kwriteconfig5", "--file", "kscreenlockerrc", "--group", "Daemon", "--key", "Autolock", "false"])
    .withExec([
      "kwriteconfig5",
      "--file",
      "~/.config/powermanagementprofilesrc",
      "--group",
      "AC",
      "--group",
      "DPMSControl",
      "--key",
      "idleTime",
      "540",
    ])
    .withLabel("org.opencontainers.image.title", "discord-plays-pokemon")
    .withLabel(
      "org.opencontainers.image.description",
      "Discord Plays Pokemon - A bot that lets Discord users play Pokemon",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha);
}

/**
 * Publish the Docker image to GitHub Container Registry
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @param registryUsername Optional registry username for authentication
 * @param registryPassword Optional registry password for authentication
 * @returns The published image references
 */
export async function publishDockerImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
  registryUsername?: string,
  registryPassword?: Secret,
): Promise<string[]> {
  const image = await buildDockerImage(workspaceSource, version, gitSha);

  if (!registryUsername || !registryPassword) {
    throw new Error("GHCR credentials are required for publishing");
  }

  // Apply registry auth to the container
  const authenticatedImage = image.withRegistryAuth("ghcr.io", registryUsername, registryPassword);

  // Publish to both version and latest tags
  const versionRef = `ghcr.io/shepherdjerred/discord-plays-pokemon:${version}`;
  const latestRef = `ghcr.io/shepherdjerred/discord-plays-pokemon:latest`;

  const [versionResult, latestResult] = await Promise.all([
    authenticatedImage.publish(versionRef),
    authenticatedImage.publish(latestRef),
  ]);

  return [versionResult, latestResult];
}
