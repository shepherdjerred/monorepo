import { $ } from "bun";
import path from "node:path";
import { adoptSeedIfUnseeded, resolveBackendLakeDir } from "./dev-lake-seed.ts";
import { unresolvedSecrets } from "./migration-core.ts";

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const missing = unresolvedSecrets(Bun.env);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} not resolved. Run with op run --env-file=${root}/dev-web.env.tpl -- bun ${import.meta.path}`,
    );
  }
  const backendCwd = path.join(root, "packages", "backend");
  console.log(
    `Applying Prisma migrations against ${Bun.env["DATABASE_URL"] ?? ""}`,
  );
  await $`bunx prisma migrate deploy`.cwd(backendCwd);

  // Explore and every ScoutQL report read the lake, not the database, so a
  // checkout without one answers every question with no rows. Copy the shared
  // seed in before the backend starts and begins folding into it.
  //
  // Resolved against the backend's cwd because that is how the backend itself
  // reads `REPORT_LAKE_DIR`, then handed back to it absolute so the seeded
  // directory and the queried one cannot drift apart.
  const lakeDir = resolveBackendLakeDir(backendCwd, Bun.env["REPORT_LAKE_DIR"]);
  console.log(await adoptSeedIfUnseeded(lakeDir));

  const environment = {
    ...Bun.env,
    ENABLE_DEV_LOGIN: "true",
    REPORT_LAKE_DIR: lakeDir,
  };
  const backend = Bun.spawn(["bun", "--watch", "src/index.ts"], {
    cwd: backendCwd,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const app = Bun.spawn(["bun", "run", "dev"], {
    cwd: `${root}/packages/app`,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(
    "Scout local dev is starting\nSPA: http://localhost:5180/app/\nBackend: http://localhost:3000/trpc/",
  );
  const stop = (): void => {
    backend.kill();
    app.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const exitCode = await Promise.race([backend.exited, app.exited]);
  stop();
  await Promise.all([backend.exited, app.exited]);
  process.exitCode = exitCode;
}
