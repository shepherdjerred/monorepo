import Docker from "dockerode";
import type { Container } from "dockerode";
import * as net from "net";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";
import type {
  ContainerConfig,
  ContainerInfo,
  ContainerStatus,
} from "./types.js";

const SANDBOX_IMAGE = "claude-sandbox:latest";
const CONTAINER_PREFIX = "claude-session-";

export interface SandboxResult {
  container: Container;
  stream: NodeJS.ReadWriteStream;
}

export class ContainerManager {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
  }

  /**
   * Create, attach, and start a new sandbox container for a session
   * IMPORTANT: Must attach BEFORE starting to get stdin/stdout stream
   */
  async createSandbox(config: ContainerConfig): Promise<SandboxResult> {
    const containerConfig = getConfig();

    const containerName = `${CONTAINER_PREFIX}${config.sessionId}`;

    logger.info("Creating sandbox container", {
      name: containerName,
      repoUrl: config.repoUrl,
      branch: config.branch,
    });

    // Parse memory limit (e.g., "2g" -> 2GB in bytes)
    const memoryLimit = this.parseMemoryLimit(
      containerConfig.CONTAINER_MEMORY_LIMIT,
    );

    const container = await this.docker.createContainer({
      Image: SANDBOX_IMAGE,
      name: containerName,
      Env: [
        `ANTHROPIC_API_KEY=${containerConfig.ANTHROPIC_API_KEY}`,
        `GITHUB_TOKEN=${config.githubToken}`,
        `GIT_USER_NAME=${config.userName}`,
        `GIT_USER_EMAIL=${config.userEmail}`,
        `REPO_URL=${config.repoUrl}`,
        `BASE_BRANCH=${config.baseBranch}`,
        `BRANCH=${config.branch}`,
        `SESSION_ID=${config.sessionId}`,
      ],
      HostConfig: {
        AutoRemove: false, // TODO: re-enable after debugging
        Memory: memoryLimit,
        CpuShares: containerConfig.CONTAINER_CPU_SHARES,
        NetworkMode: "bridge",
      },
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
    });

    logger.info("Container created, starting...", { id: container.id });

    await container.start();

    logger.info("Container started, attaching via raw socket...", {
      id: container.id,
    });

    // Use raw Docker socket for attach (works with Bun)
    const stream = await this.attachRawSocket(container.id);

    logger.info("Sandbox container ready", {
      id: container.id,
      name: containerName,
    });

    return { container, stream };
  }

  /**
   * Attach to a running container's stdin/stdout
   * Note: This only works reliably if you attach before starting the container
   */
  async attachToContainer(
    containerId: string,
  ): Promise<NodeJS.ReadWriteStream> {
    const container = this.docker.getContainer(containerId);

    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    });

    return stream;
  }

  /**
   * Get a container by ID
   */
  getContainer(containerId: string): Container {
    return this.docker.getContainer(containerId);
  }

  /**
   * Stop a running container
   */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 }); // 10 second timeout
      logger.info("Container stopped", { id: containerId });
    } catch (error) {
      // Container might already be stopped/removed
      logger.warn("Failed to stop container", { id: containerId, error });
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true });
      logger.info("Container removed", { id: containerId });
    } catch (error) {
      // Container might already be removed
      logger.warn("Failed to remove container", { id: containerId, error });
    }
  }

  /**
   * Get container info
   */
  async getContainerInfo(containerId: string): Promise<ContainerInfo | null> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();

      return {
        id: info.Id,
        name: info.Name.replace(/^\//, ""),
        status: this.mapDockerStatus(info.State.Status),
        createdAt: new Date(info.Created),
      };
    } catch {
      return null;
    }
  }

  /**
   * List all claude-web session containers
   */
  async listSessionContainers(): Promise<ContainerInfo[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        name: [CONTAINER_PREFIX],
      },
    });

    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, "") || "",
      status: this.mapDockerStatus(c.State),
      createdAt: new Date(c.Created * 1000),
    }));
  }

  /**
   * Execute a command in a running container using raw socket (Bun compatible)
   */
  async execInContainer(containerId: string, cmd: string[]): Promise<string> {
    // First, create the exec instance via HTTP
    const createBody = JSON.stringify({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const execId = await this.createExecRaw(containerId, createBody);

    // Then start and read output via raw socket
    return this.startExecRaw(execId);
  }

  /**
   * Create exec instance using raw HTTP to Docker socket
   */
  private createExecRaw(containerId: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: "/var/run/docker.sock" });

      socket.on("connect", () => {
        const request = [
          `POST /containers/${containerId}/exec HTTP/1.1`,
          "Host: localhost",
          "Content-Type: application/json",
          `Content-Length: ${Buffer.byteLength(body)}`,
          "",
          body,
        ].join("\r\n");

        socket.write(request);
      });

      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();

        // Look for end of headers and JSON body
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const headers = buffer.slice(0, headerEnd);

          // Handle chunked encoding
          if (headers.includes("Transfer-Encoding: chunked")) {
            const bodyStart = headerEnd + 4;
            const remaining = buffer.slice(bodyStart);

            // Parse chunked response - find the JSON object
            const jsonMatch = remaining.match(/\{[^}]+\}/);
            if (jsonMatch) {
              try {
                const result = JSON.parse(jsonMatch[0]) as { Id: string };
                socket.destroy();
                resolve(result.Id);
              } catch {
                // Wait for more data
              }
            }
          } else {
            // Non-chunked response
            const bodyStart = headerEnd + 4;
            const jsonBody = buffer.slice(bodyStart);
            try {
              const result = JSON.parse(jsonBody) as { Id: string };
              socket.destroy();
              resolve(result.Id);
            } catch {
              // Wait for more data
            }
          }
        }
      });

      socket.on("error", reject);

      setTimeout(() => {
        socket.destroy();
        reject(new Error("Exec create timeout"));
      }, 10000);
    });
  }

  /**
   * Start exec and read output using raw socket
   */
  private startExecRaw(execId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: "/var/run/docker.sock" });

      const startBody = JSON.stringify({ Detach: false, Tty: false });

      socket.on("connect", () => {
        const request = [
          `POST /exec/${execId}/start HTTP/1.1`,
          "Host: localhost",
          "Content-Type: application/json",
          "Connection: Upgrade",
          "Upgrade: tcp",
          `Content-Length: ${Buffer.byteLength(startBody)}`,
          "",
          startBody,
        ].join("\r\n");

        socket.write(request);
      });

      let headersParsed = false;
      let buffer = Buffer.alloc(0);
      let output = "";

      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (!headersParsed) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            headersParsed = true;
            buffer = buffer.slice(headerEnd + 4);
          }
        }

        if (headersParsed) {
          // Parse Docker multiplexed stream format
          // Each frame: [type(1) | 0 0 0 | size(4)] [payload]
          while (buffer.length >= 8) {
            const size = buffer.readUInt32BE(4);
            if (buffer.length < 8 + size) break;

            const payload = buffer.slice(8, 8 + size);
            output += payload.toString();
            buffer = buffer.slice(8 + size);
          }
        }
      };

      socket.on("data", onData);

      socket.on("end", () => {
        resolve(output);
      });

      socket.on("close", () => {
        resolve(output);
      });

      socket.on("error", (err) => {
        logger.error("Exec socket error", { error: err });
        reject(err);
      });

      setTimeout(() => {
        socket.destroy();
        resolve(output); // Return what we have
      }, 30000);
    });
  }

  /**
   * Check if the sandbox image exists
   */
  async imageExists(): Promise<boolean> {
    try {
      await this.docker.getImage(SANDBOX_IMAGE).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attach to container using raw Unix socket (works with Bun)
   * Dockerode's attach doesn't work properly with Bun runtime
   */
  private attachRawSocket(containerId: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: "/var/run/docker.sock" });

      socket.on("connect", () => {
        // Send HTTP upgrade request for attach
        const request = [
          `POST /containers/${containerId}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1`,
          "Host: localhost",
          "Connection: Upgrade",
          "Upgrade: tcp",
          "",
          "",
        ].join("\r\n");

        socket.write(request);
      });

      let headersParsed = false;
      let buffer = Buffer.alloc(0);

      const onData = (chunk: Buffer) => {
        if (headersParsed) return;

        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf("\r\n\r\n");

        if (headerEnd !== -1) {
          const headers = buffer.slice(0, headerEnd).toString();
          logger.debug("Docker attach response headers", {
            headers: headers.substring(0, 200),
          });

          // Check for successful upgrade
          if (headers.includes("101") || headers.includes("200")) {
            headersParsed = true;
            socket.removeListener("data", onData);

            // Push any remaining data back
            const remaining = buffer.slice(headerEnd + 4);
            if (remaining.length > 0) {
              socket.unshift(remaining);
            }

            logger.info("Raw socket attach successful", { containerId });
            resolve(socket);
          } else {
            reject(new Error(`Docker attach failed: ${headers}`));
          }
        }
      };

      socket.on("data", onData);

      socket.on("error", (err) => {
        logger.error("Raw socket error", { error: err });
        reject(err);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!headersParsed) {
          socket.destroy();
          reject(new Error("Docker attach timeout"));
        }
      }, 5000);
    });
  }

  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([gmk]?)$/i);
    if (!match || !match[1]) return 2 * 1024 * 1024 * 1024; // Default 2GB

    const value = parseInt(match[1], 10);
    const unit = (match[2] ?? "b").toLowerCase();

    switch (unit) {
      case "g":
        return value * 1024 * 1024 * 1024;
      case "m":
        return value * 1024 * 1024;
      case "k":
        return value * 1024;
      default:
        return value;
    }
  }

  private mapDockerStatus(status: string): ContainerStatus {
    switch (status.toLowerCase()) {
      case "created":
        return "pending";
      case "running":
        return "running";
      case "paused":
      case "restarting":
        return "starting";
      case "exited":
      case "dead":
      case "removing":
        return "stopped";
      default:
        return "error";
    }
  }
}

// Export singleton instance
export const containerManager = new ContainerManager();
