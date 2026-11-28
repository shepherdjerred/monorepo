import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { runPackageCommand, startSmokePostgres } from "./smoke-postgres.ts";

function reservePort(): number {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {
        /* unused */
      },
    },
  });
  const { port } = listener;
  listener.stop();
  return port;
}

const SubscriptionsSchema = z.object({
  subscriptions: z.array(z.object({ id: z.string() })),
});
const ItemRefsSchema = z.object({
  itemRefs: z.array(z.object({ id: z.string() })),
});

const root = await mkdtemp(path.join(tmpdir(), "feeds-smoke-"));
// The deployment path: migrate an empty PostgreSQL, then serve from it.
const postgres = await startSmokePostgres(root);
const dbEnv = { DATABASE_URL: postgres.databaseUrl };
await runPackageCommand(
  ["bun", "x", "--no-install", "prisma", "migrate", "deploy"],
  dbEnv,
);
const consolePort = reservePort();
const readerPort = reservePort();
const consoleOrigin = `http://127.0.0.1:${String(consolePort)}`;
const readerOrigin = `http://127.0.0.1:${String(readerPort)}`;

const baseEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(Bun.env)) {
  if (value !== undefined) baseEnv[key] = value;
}

const child = Bun.spawn(
  [process.execPath, path.join(import.meta.dirname, "index.ts")],
  {
    env: {
      ...baseEnv,
      HOST: "127.0.0.1",
      PORT: String(consolePort),
      FEEDS_READER_PORT: String(readerPort),
      ...dbEnv,
      FEEDS_PUBLIC_ORIGIN: consoleOrigin,
      FEEDS_TRUSTED_PROXIES: "127.0.0.1",
      FEEDS_OPERATOR_LOGINS: "smoke@example.com",
      FEEDS_MACHINE_TOKEN: "synthetic-smoke-machine",
      FEEDS_READER_USER: "sjerred",
      FEEDS_READER_PASSWORD: "synthetic-smoke-password",
      FEEDS_WRITE_TOKEN_SECRET: "synthetic-smoke-write-secret",
      FEATURE_FLAGS_MODE: "disabled",
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);

try {
  const signal = AbortSignal.timeout(30_000);
  let ready = false;
  while (!ready) {
    signal.throwIfAborted();
    if (child.exitCode !== null) {
      throw new Error("feeds exited before becoming healthy");
    }
    const [h1, h2] = await Promise.all([
      fetch(`${consoleOrigin}/healthz`, { signal })
        .then((r) => r.ok)
        .catch(() => false),
      fetch(`${readerOrigin}/healthz`, { signal })
        .then((r) => r.ok)
        .catch(() => false),
    ]);
    ready = h1 && h2;
    if (!ready) await Bun.sleep(100);
  }

  const unauth = await fetch(`${consoleOrigin}/`, { signal });
  if (unauth.status !== 403) {
    throw new Error(
      `Expected 403 without Tailscale login, got ${String(unauth.status)}`,
    );
  }

  const readerRoot = await fetch(`${readerOrigin}/`, { signal });
  if (readerRoot.status !== 404) {
    throw new Error(
      `Expected 404 on reader root, got ${String(readerRoot.status)}`,
    );
  }

  const page = await fetch(`${consoleOrigin}/`, {
    headers: { "tailscale-user-login": "smoke@example.com" },
    signal,
  });
  const html = await page.text();
  if (!page.ok || !html.includes('<div id="root"></div>')) {
    throw new Error("feeds console did not serve built HTML shell");
  }
  const asset = /src="([^"]+\.js)"/u.exec(html)?.[1];
  if (asset === undefined) {
    throw new Error("feeds console HTML missing JS bundle script");
  }
  const assetRes = await fetch(new URL(asset, page.url), {
    headers: { "tailscale-user-login": "smoke@example.com" },
    signal,
  });
  if (!assetRes.ok) {
    throw new Error("feeds console JS bundle returned non-200");
  }

  const login = await fetch(
    `${readerOrigin}/api/greader.php/accounts/ClientLogin`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "Email=sjerred&Passwd=synthetic-smoke-password",
      signal,
    },
  );
  const loginText = await login.text();
  const auth = loginText
    .split("\n")
    .find((line) => line.startsWith("Auth="))
    ?.slice(5);
  if (auth === undefined || auth.length === 0 || !login.ok) {
    throw new Error("ReaderAPI ClientLogin failed during smoke check");
  }

  const subsRes = await fetch(
    `${readerOrigin}/api/greader.php/reader/api/0/subscription/list?output=json`,
    { headers: { authorization: `GoogleLogin auth=${auth}` }, signal },
  );
  if (!subsRes.ok) {
    throw new Error("ReaderAPI subscription/list failed during smoke check");
  }
  const subs = SubscriptionsSchema.parse(await subsRes.json());
  if (subs.subscriptions.length !== 65) {
    throw new Error(
      `Expected 65 seeded catalog feeds, got ${String(subs.subscriptions.length)}`,
    );
  }

  const idsRes = await fetch(
    `${readerOrigin}/api/greader.php/reader/api/0/stream/items/ids?s=user/-/state/com.google/reading-list&n=10`,
    { headers: { authorization: `GoogleLogin auth=${auth}` }, signal },
  );
  if (!idsRes.ok) {
    throw new Error("ReaderAPI stream/items/ids failed during smoke check");
  }
  ItemRefsSchema.parse(await idsRes.json());
} finally {
  child.kill("SIGTERM");
  await child.exited;
  await postgres.stop();
  await rm(root, { recursive: true, force: true });
}
