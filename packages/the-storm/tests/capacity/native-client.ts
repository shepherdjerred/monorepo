import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packageRoot } from "#e2e/harness/paths.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import { startClient } from "#client/process.ts";
import type { Session } from "#client/protocol.ts";

/** Shared disposable-client bootstrap; each native acceptance retains its own original artifacts. */
export async function startCapacityClient(
  server: ServerInfo,
  family: "capacity-native" | "capacity-frame-pacing",
) {
  const privateDir = await mkdtemp(path.join(tmpdir(), "rwf-native-"));
  const artifacts = path.join(
    packageRoot,
    ".cache/e2e",
    family,
    path.basename(privateDir),
  );
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const session: Session = {
    socket: path.join(privateDir, "client.sock"),
    control: path.join(privateDir, "unused-control.sock"),
    artifacts,
    server: `127.0.0.1:${server.gamePort.toString()}`,
  };
  const client = await startClient({
    session,
    privateDir,
    packageRoot,
    onExit: () => {
      console.warn("Owned native capacity client exited");
    },
  });
  return { session, artifacts, client };
}
