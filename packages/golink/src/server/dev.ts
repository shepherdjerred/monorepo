import path from "node:path";
import { z } from "zod";
import { loadPlatformSites } from "#domain/platform-sites.ts";
import {
  createDatabase,
  createInMemoryManualLinkRepository,
  createPrismaManualLinkRepository,
} from "#infrastructure/db.ts";
import { createGolinkMetrics } from "#infrastructure/telemetry.ts";
import { createGolinkServer } from "./app.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const modelPath = path.resolve(
  packageRoot,
  "../homelab/src/platform-model.json",
);

const DevPlatformTailnetSchema = z.object({
  tailnet: z
    .object({
      domain: z.string().default("tailnet-1a49.ts.net"),
    })
    .optional(),
  tailnetServices: z
    .array(
      z.object({
        host: z.string().min(1),
      }),
    )
    .default([]),
});

const rawModel: unknown = JSON.parse(await Bun.file(modelPath).text());
const parsedModel = DevPlatformTailnetSchema.parse(rawModel);
const tailnetDomain =
  Bun.env["TAILNET_DOMAIN"]?.trim() ??
  parsedModel.tailnet?.domain ??
  "tailnet-1a49.ts.net";
const mockIngressHosts = parsedModel.tailnetServices.map(
  (service) => `${service.host}.${tailnetDomain}`,
);
const platformSites = await loadPlatformSites(modelPath);

const databaseUrl = Bun.env["DATABASE_URL"]?.trim();
const repo =
  databaseUrl === undefined || databaseUrl === ""
    ? createInMemoryManualLinkRepository({
        initial: [
          {
            short: "ha",
            targetUrl: `https://homeassistant.${tailnetDomain}/`,
            createdBy: "jerred@tailnet",
          },
          {
            short: "k8s",
            targetUrl: `https://argocd.${tailnetDomain}/applications`,
            createdBy: "jerred@tailnet",
          },
        ],
      })
    : createPrismaManualLinkRepository(createDatabase(databaseUrl));

const portRaw = Bun.env["PORT"]?.trim();
const port =
  portRaw === undefined || portRaw === "" ? 7352 : Number.parseInt(portRaw, 10);
const host = Bun.env["HOST"]?.trim() ?? "127.0.0.1";

const server = createGolinkServer({
  repo,
  getIngressHosts: () => mockIngressHosts,
  platformSites,
  tailnetDomain,
  dynamicAliasesEnabled: () => Promise.resolve(true),
  writesEnabled: () => Promise.resolve(true),
  metrics: createGolinkMetrics(),
  hostname: host,
  port,
  onShutdown: async () => {
    await repo.close();
  },
});
const listening = server.start({ handleSignals: false });

console.warn(
  JSON.stringify({
    message: "golink_dev_api_started",
    url: `http://${host}:${String(listening.port)}`,
    storage:
      databaseUrl === undefined || databaseUrl === "" ? "memory" : "postgres",
  }),
);

const shouldSpawnVite = Bun.env["GOLINK_NO_VITE"] !== "1";
const viteChild = shouldSpawnVite
  ? Bun.spawn(["bunx", "--no-install", "vite"], {
      cwd: packageRoot,
      env: Bun.env,
      stdout: "inherit",
      stderr: "inherit",
    })
  : undefined;

async function shutdown(): Promise<void> {
  viteChild?.kill();
  if (viteChild !== undefined) {
    await viteChild.exited;
  }
  await server.stop();
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});

if (viteChild !== undefined) {
  await viteChild.exited;
  await shutdown();
}
