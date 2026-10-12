import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { autonomyEnabled } from "#src/host/autonomy-policy.ts";
import { ConfigSchema, LinearIssueSchema } from "#src/domain/schemas.ts";
import { runtimePaths } from "#src/runtime/paths.ts";

afterEach(shutdownFeatureFlags);

describe("autonomous delivery policy", () => {
  test("file targeting is fresh and a resolved false flag revokes it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "justin-policy-"));
    const paths = runtimePaths(home);
    const config = ConfigSchema.parse(
      await Bun.file(
        new URL("../../config.example.json", import.meta.url),
      ).json(),
    );
    const issue = LinearIssueSchema.parse({
      id: "fixture",
      identifier: "AI-104",
      title: "CLI help",
      description: null,
      url: "https://linear.app/example/issue/AI-104",
      priority: 1,
      createdAt: "2026-01-01T00:00:00Z",
      team: { key: "AI" },
      state: { name: "Todo", type: "unstarted" },
      labels: { nodes: [] },
    });
    try {
      await initFeatureFlags({
        environment: { FEATURE_FLAGS_MODE: "disabled" },
      });
      await Bun.write(paths.config, JSON.stringify(config));
      await expect(autonomyEnabled(issue, paths)).resolves.toBe(false);
      await Bun.write(
        paths.config,
        JSON.stringify({
          ...config,
          autonomy: { enabledIssueIdentifiers: ["AI-104"] },
        }),
      );
      await expect(autonomyEnabled(issue, paths)).resolves.toBe(true);
      await expect(
        autonomyEnabled({ ...issue, identifier: "AI-105" }, paths),
      ).resolves.toBe(false);
      await shutdownFeatureFlags();
      await initFeatureFlags({
        environment: { FEATURE_FLAGS_MODE: "disabled" },
        provider: new StaticProvider({
          justin_autonomous_devex_enabled: false,
        }),
      });
      await expect(autonomyEnabled(issue, paths)).resolves.toBe(false);
    } finally {
      await rm(home, { recursive: true });
    }
  });
});
