import path from "node:path";
import { ClientStatusResponseSchema } from "@shepherdjerred/mc-harness/protocol/client.ts";
import { SOCKET_PATH } from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { SessionSchema } from "./protocol.ts";

/** Compatibility entry point; the harness owns the authenticated process and all live guards. */
export async function live(): Promise<void> {
  const reason = "TSMC documentation capture";
  const child = Bun.spawn(
    [
      "toolkit",
      "mc",
      "client",
      "start",
      "--target",
      "live",
      "--account",
      "XiguaJerred",
      "--reason",
      reason,
      "--json",
    ],
    {
      stdout: "pipe",
      stderr: "inherit",
      env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
    },
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw new Error("Harness live client launch failed");
  const { client } = ClientStatusResponseSchema.parse(JSON.parse(output));
  const session = SessionSchema.parse({
    socket: SOCKET_PATH,
    control: SOCKET_PATH,
    artifacts: client.artifacts,
    server: client.server,
    client: client.name,
    reason,
  });
  const file = path.join(client.artifacts, "session.json");
  await Bun.write(file, JSON.stringify(session, null, 2));
  process.stdout.write(`Live client ready. Session: ${file}\n`);
}
