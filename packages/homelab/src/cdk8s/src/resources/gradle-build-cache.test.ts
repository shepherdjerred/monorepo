import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, Chart } from "cdk8s";
import { afterEach, describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { GRADLE_BUILD_CACHE_USERS } from "@shepherdjerred/woodpecker-config-extension/src/pipeline/gradle-build-cache.ts";
import {
  createGradleBuildCacheDeployment,
  gradleBuildCacheConfigScript,
} from "./gradle-build-cache.ts";

const ConfigSchema = z.strictObject({
  version: z.literal(5),
  cache: z.strictObject({
    targetSize: z.strictObject({
      type: z.literal("fixed"),
      size: z.number(),
    }),
    accessControl: z.strictObject({
      anonymousLevel: z.literal("none"),
      users: z.record(
        z.string(),
        z.strictObject({
          password: z.string(),
          level: z.enum(["read", "readwrite"]),
        }),
      ),
    }),
  }),
  uiAccess: z.strictObject({ type: z.literal("disabled") }),
});

const scratch: string[] = [];
afterEach(async () => {
  for (const directory of scratch.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/**
 * Run the init script with a stand-in `build-cache-node` that prints the
 * same quoted "salt:hash" shape as the real `hash` command.
 */
async function renderConfig(passwords: Record<string, string>) {
  const directory = await mkdtemp(path.join(tmpdir(), "gradle-build-cache-"));
  scratch.push(directory);
  const fake = path.join(directory, "build-cache-node");
  await Bun.write(
    fake,
    String.raw`#!/bin/sh
[ "$1 $2 $3" = "hash --password -" ] || exit 64
IFS= read -r password
printf '"salt:%s"\n' "$password"
`,
  );
  await chmod(fake, 0o755);
  const result = Bun.spawnSync(
    ["/bin/sh", "-c", gradleBuildCacheConfigScript(directory)],
    {
      env: { PATH: `${directory}:/usr/bin:/bin`, ...passwords },
      stderr: "pipe",
    },
  );
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    config: async () =>
      ConfigSchema.parse(
        parseYaml(await Bun.file(path.join(directory, "config.yaml")).text()),
      ),
  };
}

describe("Gradle build cache node", () => {
  test("renders one credentialed user per CI trust domain", async () => {
    const rendered = await renderConfig({
      GRADLE_BUILD_CACHE_WRITE_PASSWORD: "write-secret",
      GRADLE_BUILD_CACHE_READ_PASSWORD: "read-secret",
    });
    expect(rendered.stderr).toBe("");
    expect(rendered.exitCode).toBe(0);
    const config = await rendered.config();
    expect(config.cache.accessControl.users).toEqual({
      [GRADLE_BUILD_CACHE_USERS.trusted.username]: {
        password: "salt:write-secret",
        level: "readwrite",
      },
      [GRADLE_BUILD_CACHE_USERS["pull-request"].username]: {
        password: "salt:read-secret",
        level: "read",
      },
    });
  });

  test.each<Record<string, string>>([
    { GRADLE_BUILD_CACHE_WRITE_PASSWORD: "write-secret" },
    {
      GRADLE_BUILD_CACHE_WRITE_PASSWORD: "write-secret",
      GRADLE_BUILD_CACHE_READ_PASSWORD: "",
    },
  ])("refuses a missing or empty password: %o", async (passwords) => {
    const rendered = await renderConfig(passwords);
    expect(rendered.exitCode).not.toBe(0);
    expect(rendered.stderr).toContain("GRADLE_BUILD_CACHE_READ_PASSWORD");
  });

  test("reads only the two password fields from the CI cache item", () => {
    const chart = new Chart(new App(), "gradle-build-cache", {
      namespace: "gradle-build-cache",
    });
    const { deployment, secrets } = createGradleBuildCacheDeployment(chart);
    expect(secrets.name).toBe("gradle-build-cache-secrets");
    const init = deployment.initContainers[0];
    if (init === undefined) throw new Error("Missing config init container");
    expect(init.env.sources).toHaveLength(0);
    for (const { passwordKey } of Object.values(GRADLE_BUILD_CACHE_USERS))
      expect(init.env.variables[passwordKey]?.valueFrom).toMatchObject({
        secretKeyRef: { name: "gradle-build-cache-secrets", key: passwordKey },
      });
    const node = deployment.containers[0];
    if (node === undefined) throw new Error("Missing cache node container");
    expect(Object.keys(node.env.variables)).not.toContain(
      GRADLE_BUILD_CACHE_USERS.trusted.passwordKey,
    );
    expect(() => chart.toJson()).not.toThrow();
  });
});
