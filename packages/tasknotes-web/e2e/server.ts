import path from "node:path";
import { accessToken } from "./fixture-access.ts";

const port = Bun.argv[2];
if (port === undefined || !/^\d+$/u.test(port))
  throw new Error("The browser tests require a Facet port.");
const cwd = path.resolve(import.meta.dir, "../../tasknotes-server");
const generated = Bun.spawnSync([process.execPath, "run", "generate"], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
});
if (!generated.success)
  throw new Error("The test server could not generate its Prisma client.");
const server = Bun.spawn([process.execPath, "run", "src/index.ts"], {
  cwd,
  env: {
    ...Object.fromEntries(
      Object.entries(Bun.env).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value] as const] : [],
      ),
    ),
    NODE_ENV: "production",
    DATABASE_URL: "",
    AUTH_TOKEN: accessToken,
    BUGSINK_DSN: "",
    HOST: "127.0.0.1",
    PORT: port,
  },
  stdout: "inherit",
  stderr: "inherit",
});
process.exitCode = await server.exited;
