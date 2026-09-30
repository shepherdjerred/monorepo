import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultToolkitConfigPath,
  loadToolkitConfig,
} from "#lib/toolkit-config.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function configFile(contents: string | null): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "toolkit-config-"));
  directories.push(directory);
  const file = path.join(directory, "config.toml");
  if (contents !== null) {
    await writeFile(file, contents);
  }
  return file;
}

describe("toolkit config", () => {
  test("defaults keep the metrics push off", async () => {
    const config = await loadToolkitConfig({
      environment: {},
      configPath: await configFile(null),
    });
    await expect(config.get("historyMetricsPushEnabled")).resolves.toEqual({
      value: false,
      source: "default",
    });
    await expect(config.value("historyMetricsPushEndpoint")).resolves.toBe(
      "https://otlp-metrics.tailnet-1a49.ts.net/v1/metrics",
    );
    await expect(config.value("opsDashboardUrl")).resolves.toBe(
      "https://ops.tailnet-1a49.ts.net",
    );
  });

  test("the config file enables the push for the launchd daemon", async () => {
    const config = await loadToolkitConfig({
      environment: {},
      configPath: await configFile(
        '[history.metrics.push]\nenabled = true\nendpoint = "http://localhost:4319/v1/metrics"\n',
      ),
    });
    await expect(config.get("historyMetricsPushEnabled")).resolves.toEqual({
      value: true,
      source: "file",
    });
    await expect(config.value("historyMetricsPushEndpoint")).resolves.toBe(
      "http://localhost:4319/v1/metrics",
    );
  });

  test("an explicit env false stops resolution above a file true", async () => {
    const config = await loadToolkitConfig({
      environment: { HISTORY_METRICS_PUSH_ENABLED: "false" },
      configPath: await configFile("[history.metrics.push]\nenabled = true\n"),
    });
    await expect(config.get("historyMetricsPushEnabled")).resolves.toEqual({
      value: false,
      source: "env",
    });
  });

  test("invalid values throw instead of falling back", async () => {
    const config = await loadToolkitConfig({
      environment: {
        HISTORY_METRICS_PUSH_ENABLED: "sometimes",
        OPS_DASHBOARD_URL: "not a url",
      },
      configPath: await configFile(null),
    });
    await expect(config.get("historyMetricsPushEnabled")).rejects.toThrow();
    await expect(config.get("opsDashboardUrl")).rejects.toThrow();
  });

  test("an unparseable config file throws", async () => {
    await expect(
      loadToolkitConfig({
        environment: {},
        configPath: await configFile("enabled = = true"),
      }),
    ).rejects.toThrow(/failed to parse/);
  });

  test("lives under ~/.toolkit", () => {
    expect(defaultToolkitConfigPath("/home/test")).toBe(
      "/home/test/.toolkit/config.toml",
    );
  });
});
