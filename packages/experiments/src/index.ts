import path from "node:path";
import { z } from "zod";
import {
  createInternalExperimentApp,
  createPublicExperimentApp,
} from "./app.ts";
import { createOperatorVerifier } from "./operator-identity.ts";
import { createPostgresExperimentStore } from "./postgres.ts";

const port = z.coerce.number().int().min(1024).max(65_535);
const config = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/u }),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: port.default(7407),
    INTERNAL_PORT: port.default(7408),
    EXPERIMENTS_MACHINE_TOKEN: z.string().min(1),
    EXPERIMENTS_HUB_TOKEN: z.string().min(1),
    EXPERIMENTS_PUBLIC_ORIGIN: z.url({ protocol: /^https?$/u }),
    EXPERIMENTS_OPERATOR_LOGINS: z
      .string()
      .transform((logins) =>
        logins
          .split(",")
          .map((login) => login.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().max(200)).min(1)),
    EXPERIMENTS_INGRESS_IDENTITY_DIR: z.string().min(1),
  })
  .refine(
    (env) => env.PORT !== env.INTERNAL_PORT,
    "Use different public and internal ports",
  )
  .refine(
    (env) => env.EXPERIMENTS_MACHINE_TOKEN !== env.EXPERIMENTS_HUB_TOKEN,
    "Use different Toolkit and Hub credentials",
  )
  .parse(Bun.env);

const store = createPostgresExperimentStore(config.DATABASE_URL);
const peerAddresses = new WeakMap<Request, string>();
const human = createOperatorVerifier({
  ingressNamespace: "experiments",
  ingressName: "experiments-experiments-ingress-ingress",
  serviceName: "experiments",
  port: config.PORT,
  host: "experiments",
  identityDirectory: config.EXPERIMENTS_INGRESS_IDENTITY_DIR,
  operatorLogins: config.EXPERIMENTS_OPERATOR_LOGINS,
  publicOrigin: config.EXPERIMENTS_PUBLIC_ORIGIN,
});
const publicApp = createPublicExperimentApp({
  store,
  machineToken: config.EXPERIMENTS_MACHINE_TOKEN,
  verifyOperator: human,
  peerAddress: (request) => peerAddresses.get(request) ?? null,
  browserRoot: path.resolve(import.meta.dir, "../dist/client"),
});
const internalApp = createInternalExperimentApp({
  store,
  hubToken: config.EXPERIMENTS_HUB_TOKEN,
  operatorLogins: config.EXPERIMENTS_OPERATOR_LOGINS,
});
const publicServer = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  fetch(request, server) {
    const peer = server.requestIP(request);
    if (peer !== null) peerAddresses.set(request, peer.address);
    return publicApp.fetch(request);
  },
});
const internalServer = Bun.serve({
  hostname: config.HOST,
  port: config.INTERNAL_PORT,
  fetch: internalApp.fetch,
});
console.warn(
  `Experiments listening on ${String(config.PORT)} and ${String(config.INTERNAL_PORT)}`,
);

async function shutdown() {
  await Promise.all([publicServer.stop(), internalServer.stop()]);
  await store.close();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
