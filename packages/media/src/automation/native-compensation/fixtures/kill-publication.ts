import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { FileContext } from "#automation/files/types.ts";

export async function killPublicationChild(
  db: Database,
  fixture: { directory: string; context: FileContext },
  input: { attemptId: string; operationId: string },
  phase: string,
) {
  const ports = await db.$queryRaw<
    { port: number }[]
  >`SELECT inet_server_port() AS port`;
  const port = z.int().positive().parse(ports[0]?.port);
  const mount = await db.mediaStorageAuthority.findUniqueOrThrow({
    where: { rootPath: "/data/movies" },
  });
  const config = path.join(fixture.directory, "publication-crash.json");
  await writeFile(
    config,
    JSON.stringify({
      databaseUrl: `postgres://media@127.0.0.1:${String(port)}/postgres`,
      roots: fixture.context.roots,
      serverMachineId: fixture.context.serverMachineId,
      movieSectionId: await fixture.context.permittedMovieSection?.(),
      workerPodUid: mount.workerPodUid,
      input,
      phase,
    }),
  );
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("crash.ts", import.meta.url)), config],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let diagnostics = "";
  child.stderr.on("data", (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  try {
    const exit: unknown[] = await once(child, "exit");
    if (exit[1] !== "SIGKILL")
      throw new Error(
        `Publication child did not die at exact checkpoint: ${diagnostics}`,
      );
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
}
