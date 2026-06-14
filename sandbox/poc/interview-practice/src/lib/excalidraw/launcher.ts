export type ExcalidrawContainer = {
  containerId: string;
  port: number;
  url: string;
};

export async function startContainer(
  port: number,
  image: string,
): Promise<ExcalidrawContainer> {
  // Stop any existing Excalidraw container on this port to ensure a clean state
  await stopContainersByPort(port);

  const proc = Bun.spawn(
    [
      "docker",
      "run",
      "-d",
      "--name",
      `excalidraw-interview-${String(port)}`,
      "-p",
      `${String(port)}:80`,
      image,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to start Excalidraw container: ${stderr.trim()}`);
  }

  const stdout = await new Response(proc.stdout).text();
  const containerId = stdout.trim();

  return {
    containerId,
    port,
    url: `http://localhost:${String(port)}`,
  };
}

async function stopContainersByPort(port: number): Promise<void> {
  // Remove any existing container with our naming convention
  const name = `excalidraw-interview-${String(port)}`;
  const proc = Bun.spawn(["docker", "rm", "-f", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}

export async function stopContainer(containerId: string): Promise<void> {
  const proc = Bun.spawn(["docker", "rm", "-f", containerId], {
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
}

export async function healthCheck(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${String(port)}`);
    return response.ok;
  } catch {
    return false;
  }
}

export function getUrl(port: number): string {
  return `http://localhost:${String(port)}`;
}
