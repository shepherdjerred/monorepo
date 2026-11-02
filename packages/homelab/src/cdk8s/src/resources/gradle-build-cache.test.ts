import { chmod, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, Chart } from "cdk8s";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { GRADLE_BUILD_CACHE_USERS } from "@shepherdjerred/woodpecker-config-extension/src/pipeline/gradle-build-cache.ts";
import {
  createGradleBuildCacheDeployment,
  gradleBuildCacheNginxConfig,
  gradleBuildCachePrepareScript,
} from "./gradle-build-cache.ts";

const WRITER = GRADLE_BUILD_CACHE_USERS.trusted;
const READER = GRADLE_BUILD_CACHE_USERS["pull-request"];
const PASSWORDS = {
  [WRITER.passwordKey]: "write-secret",
  [READER.passwordKey]: "read-secret",
};

const scratch: string[] = [];
afterEach(async () => {
  for (const directory of scratch.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/**
 * Run the prepare script with a stand-in `cryptpw` that prints the same
 * `$6$salt$hash` shape as BusyBox, reading the password from stdin.
 */
async function prepare(
  passwords: Record<string, string>,
  hashPrefix = "$6$salt$",
) {
  const directory = await mkdtemp(path.join(tmpdir(), "gradle-build-cache-"));
  scratch.push(directory);
  const bin = path.join(directory, "bin");
  const data = path.join(directory, "data");
  const auth = path.join(directory, "auth");
  await Promise.all([mkdir(bin), mkdir(data), mkdir(auth)]);
  const fake = path.join(bin, "cryptpw");
  await Bun.write(
    fake,
    String.raw`#!/bin/sh
[ "$1 $2 $3 $4" = "-m sha512 -P 0" ] || exit 64
IFS= read -r password
printf '%s%s\n' '${hashPrefix}' "$password"
`,
  );
  await chmod(fake, 0o755);
  const run = () => {
    const result = Bun.spawnSync(
      ["/bin/sh", "-c", gradleBuildCachePrepareScript(data, auth)],
      { env: { PATH: `${bin}:/usr/bin:/bin`, ...passwords }, stderr: "pipe" },
    );
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  };
  return {
    data,
    run,
    file: (name: string) => Bun.file(path.join(auth, name)).text(),
  };
}

describe("Gradle build cache", () => {
  test("lets both CI users load and only the trusted user store", async () => {
    const prepared = await prepare(PASSWORDS);
    expect(prepared.run()).toEqual({ exitCode: 0, stderr: "" });
    expect(await prepared.file("users")).toBe(
      `${WRITER.username}:$6$salt$write-secret\n${READER.username}:$6$salt$read-secret\n`,
    );
    expect(await prepared.file("writers")).toBe(
      `${WRITER.username}:$6$salt$write-secret\n`,
    );
  });

  test.each<Record<string, string>>([
    { [WRITER.passwordKey]: "write-secret" },
    { [WRITER.passwordKey]: "write-secret", [READER.passwordKey]: "" },
  ])("refuses a missing or empty password: %o", async (passwords) => {
    const prepared = await prepare(passwords);
    const result = prepared.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(READER.passwordKey);
  });

  test("refuses anything but a SHA-512 crypt hash", async () => {
    const prepared = await prepare(PASSWORDS, "{PLAIN}");
    const result = prepared.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SHA-512");
  });

  test("evicts stale entries and abandoned uploads on start", async () => {
    const prepared = await prepare(PASSWORDS);
    const entry = (name: string) => path.join(prepared.data, "cache", name);
    const upload = path.join(prepared.data, ".upload", "0000000001");
    await Bun.write(entry("fresh"), "fresh");
    await Bun.write(entry("stale"), "stale");
    await Bun.write(upload, "partial");
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(entry("stale"), old, old);
    expect(prepared.run().exitCode).toBe(0);
    expect(await Bun.file(entry("fresh")).exists()).toBe(true);
    expect(await Bun.file(entry("stale")).exists()).toBe(false);
    expect(await Bun.file(upload).exists()).toBe(false);
  });

  test("authenticates every cache request and checks writes against writers only", () => {
    const config = gradleBuildCacheNginxConfig("/data", "/auth");
    const cache = /location \/cache\/ \{([\s\S]*?)\n {4}\}/.exec(config)?.[1];
    if (cache === undefined) throw new Error("Missing /cache/ location");
    expect(cache).toContain('auth_basic "Gradle build cache";');
    expect(cache).toContain("auth_basic_user_file /auth/users;");
    expect(cache).toMatch(
      /limit_except GET HEAD \{\s*auth_basic_user_file \/auth\/writers;\s*\}/,
    );
    expect(cache).toContain("dav_methods PUT;");
    // Uploads land on the claim so the final rename is atomic.
    expect(config).toContain("client_body_temp_path /data/.upload;");
    expect(config).not.toContain("auth_basic off");
    expect(config).not.toContain("autoindex");
  });

  test("reads only the two password fields, in the prepare step", () => {
    const chart = new Chart(new App(), "gradle-build-cache", {
      namespace: "gradle-build-cache",
    });
    const { deployment, secrets } = createGradleBuildCacheDeployment(chart);
    expect(secrets.name).toBe("gradle-build-cache-secrets");
    const init = deployment.initContainers[0];
    if (init === undefined) throw new Error("Missing prepare init container");
    expect(init.env.sources).toHaveLength(0);
    for (const { passwordKey } of [WRITER, READER])
      expect(init.env.variables[passwordKey]?.valueFrom).toMatchObject({
        secretKeyRef: { name: "gradle-build-cache-secrets", key: passwordKey },
      });
    const server = deployment.containers[0];
    if (server === undefined) throw new Error("Missing nginx container");
    expect(server.env.sources).toHaveLength(0);
    expect(Object.keys(server.env.variables)).not.toContain(WRITER.passwordKey);
    expect(server.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(server.securityContext.ensureNonRoot).toBe(true);
    const pod = z
      .object({ annotations: z.record(z.string(), z.string()) })
      .parse(deployment.podMetadata.toJson());
    expect(pod.annotations["config-hash"]).toMatch(/^[0-9a-f]{12}$/);
    expect(() => chart.toJson()).not.toThrow();
  });
});
