import { RconClient } from "#e2e/harness/rcon.ts";

export async function verifyRconReady(
  endpoint: { host: string; port: number },
  password: string,
  deadline: number,
): Promise<void> {
  const client = await RconClient.connect({
    host: endpoint.host,
    port: endpoint.port,
    password,
    timeoutMs: Math.max(1, deadline - Date.now()),
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  });
  try {
    await client.command("list");
    if (Date.now() > deadline)
      throw new Error("RCON readiness exceeded the server boot deadline");
  } finally {
    client.close();
  }
}
