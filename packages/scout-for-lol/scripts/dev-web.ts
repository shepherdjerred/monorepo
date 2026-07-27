import { $ } from "bun";
import { unresolvedSecrets } from "./migration-core.ts";

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const missing = unresolvedSecrets(Bun.env);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} not resolved. Run with op run --env-file=${root}/dev-web.env.tpl -- bun ${import.meta.path}`,
    );
  }
  console.log(
    `Applying Prisma migrations against ${Bun.env["DATABASE_URL"] ?? ""}`,
  );
  await $`bunx prisma migrate deploy`.cwd(`${root}/packages/backend`);

  const environment = { ...Bun.env, ENABLE_DEV_LOGIN: "true" };
  const backend = Bun.spawn(["bun", "--watch", "src/index.ts"], {
    cwd: `${root}/packages/backend`,
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
