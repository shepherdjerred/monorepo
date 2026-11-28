const origin = "http://127.0.0.1:17407";
const inheritedEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(Bun.env)) {
  if (typeof value === "string") inheritedEnv[key] = value;
}

const child = Bun.spawn([process.execPath, "src/index.ts"], {
  env: {
    ...inheritedEnv,
    HOST: "127.0.0.1",
    PORT: "17407",
    INTERNAL_PORT: "17408",
    ENVIRONMENT: "test",
    DATABASE_URL: "postgresql://localhost/experiments",
    EXPERIMENTS_MACHINE_TOKEN: "fixture-machine-token",
    EXPERIMENTS_HUB_TOKEN: "fixture-hub-token",
    EXPERIMENTS_PUBLIC_ORIGIN: origin,
    EXPERIMENTS_OPERATOR_LOGINS: "fixture@example.test",
    EXPERIMENTS_INGRESS_IDENTITY_DIR: "/tmp/experiments-smoke-ingress",
  },
  stdout: "inherit",
  stderr: "inherit",
});

try {
  const signal = AbortSignal.timeout(30_000);
  let healthy = false;
  while (!healthy) {
    signal.throwIfAborted();
    if (child.exitCode !== null) {
      throw new Error("Experiments exited before becoming healthy");
    }
    const response = await fetch(`${origin}/healthz`, { signal }).catch(
      () => null,
    );
    healthy = response?.status === 200;
    if (!healthy) await Bun.sleep(100);
  }
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await child.exited;
}
