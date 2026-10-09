import { createHash, generateKeyPairSync } from "node:crypto";
import { createSigner, httpbis } from "http-message-signatures";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { parse } from "yaml";
import { createApp } from "#src/app.ts";
import fixture from "./fixtures/woodpecker-v3.18.1-config-request.json" with { type: "json" };
import { TEST_IMAGES } from "./identity.ts";

const BOT = "justin-principal-engineer[bot]";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const catalog = JSON.stringify({
  entries: Object.entries(TEST_IMAGES.catalog).map(([name, reference]) => ({
    name,
    value: reference.slice(name.length + 1),
  })),
});
const ConfigResponseSchema = z.object({
  configs: z.array(z.object({ name: z.string(), data: z.string() })),
});

function harness(
  hostedAutomationApproved = false,
  trustedGateImage?: string,
  cacheEnabled = false,
) {
  const imageFetcher = vi.fn((file: string) =>
    Promise.resolve(
      file.endsWith("catalog.json") ? catalog : `sha256:${"a".repeat(64)}`,
    ),
  );
  const base = vi.fn(() => Promise.resolve(undefined));
  const cancelSupersededPr = vi.fn(() => Promise.resolve());
  const sourceCacheEnabled = vi.fn(() => Promise.resolve(cacheEnabled));
  const app = createApp({
    sourceCacheEnabled,
    ...(trustedGateImage === undefined ? {} : { trustedGateImage }),
    publicKey: () => Promise.resolve(publicKey),
    imageFetcher,
    changedBase: base,
    verifyBase: base,
    imageReleaseBase: base,
    cancelSupersededPr,
    hostedAutomationApproved: () => Promise.resolve(hostedAutomationApproved),
  });
  return { app, imageFetcher, base, cancelSupersededPr, sourceCacheEnabled };
}

async function request(overrides: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    ...fixture,
    pipeline: {
      ...fixture.pipeline,
      author: BOT,
      sender: BOT,
      changed_files: ["packages/toolkit/src/handlers/pr.ts"],
      ...overrides,
    },
  });
  const signed = await httpbis.signMessage(
    {
      key: createSigner(privateKey, "ed25519", "test-key"),
      fields: ["@request-target", "content-digest"],
    },
    {
      method: "POST",
      url: "http://localhost/ciconfig",
      headers: {
        "content-type": "application/json",
        "content-digest": `sha-256=:${createHash("sha256").update(body).digest("base64")}:`,
      },
    },
  );
  return new Request(signed.url, {
    method: signed.method,
    headers: Object.fromEntries(
      Object.entries(signed.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(", ") : value,
      ]),
    ),
    body,
  });
}

describe("signed Justin pipeline authorization", () => {
  test("source cache canaries use the signed source refspec and keep PR storage separate", async () => {
    const image = `ghcr.io/shepherdjerred/woodpecker-config-extension@sha256:${"a".repeat(64)}`;
    const { app, sourceCacheEnabled } = harness(false, image, true);
    const response = await app.request(
      await request({ branch: "main", refspec: "ci-canary/source-cache:main" }),
    );
    expect(response.status).toBe(200);
    expect(sourceCacheEnabled).toHaveBeenCalledExactlyOnceWith(
      "ci-canary/source-cache",
    );
    const configs = ConfigResponseSchema.parse(await response.json());
    const verify = configs.configs.find(
      (config) => config.name === ".woodpecker/verify.yaml",
    );
    expect(verify?.data).toContain(
      "woodpecker-source-pr:/woodpecker/source-cache",
    );
    expect(verify?.data).not.toContain("woodpecker-source-main");
  });

  test("unapproved hosted automation cannot opt into shared source storage", async () => {
    const { app, sourceCacheEnabled } = harness(false, TEST_IMAGES.base, true);
    const response = await app.request(
      await request({
        author: "renovate[bot]",
        sender: "renovate[bot]",
        refspec: "ci-canary/unapproved:main",
      }),
    );
    expect(response.status).toBe(200);
    expect(sourceCacheEnabled).not.toHaveBeenCalled();
    const configs = ConfigResponseSchema.parse(await response.json());
    expect(
      configs.configs.every(
        (config) => !config.data.includes("woodpecker-source-"),
      ),
    ).toBe(true);
  });

  test("generates real verification workflows for a same-repository bot PR", async () => {
    const { app, imageFetcher } = harness();
    const response = await app.request(await request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configs: expect.arrayContaining([
        expect.objectContaining({ name: ".woodpecker/verify.yaml" }),
        expect.objectContaining({ name: ".woodpecker/ci-complete.yaml" }),
      ]),
    });
    expect(imageFetcher).toHaveBeenCalled();
  });

  test.each([
    { sender: "mallory" },
    { author: "mallory" },
    { from_fork: true },
    { author: "app/justin-principal-engineer" },
  ])("refuses %j before reading forge data", async (overrides) => {
    const { app, imageFetcher, base, cancelSupersededPr } = harness();
    const response = await app.request(await request(overrides));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "actor is not permitted to run CI",
    });
    expect(imageFetcher).not.toHaveBeenCalled();
    expect(base).not.toHaveBeenCalled();
    expect(cancelSupersededPr).not.toHaveBeenCalled();
  });

  test("a trusted bot name cannot admit an unsigned request", async () => {
    const { app, imageFetcher } = harness();
    const unsigned = await request();
    unsigned.headers.delete("signature");
    unsigned.headers.delete("signature-input");
    const response = await app.request(unsigned);
    expect(response.status).toBe(401);
    expect(imageFetcher).not.toHaveBeenCalled();
  });
});

describe("signed workflow routing", () => {
  const gateImage = `ghcr.io/shepherdjerred/woodpecker-config-extension@sha256:${"c".repeat(64)}`;
  test("cleanup failures preserve the full replacement verification graph", async () => {
    const { app, cancelSupersededPr } = harness(true, gateImage);
    cancelSupersededPr.mockRejectedValue(new Error("cleanup failed"));
    const response = await app.request(await request());
    expect(response.status).toBe(200);
    const result = ConfigResponseSchema.parse(await response.json());
    expect(
      result.configs.some((entry) => entry.name.endsWith("/ci-complete.yaml")),
    ).toBe(true);
    expect(cancelSupersededPr).toHaveBeenCalledTimes(1);
  });
  test("ready-for-review runs the full PR graph with PR cache trust and native status contexts", async () => {
    const { app } = harness(true, gateImage);
    const changes = { changed_files: [] };
    const normalResponse = await app.request(await request(changes));
    const normal = ConfigResponseSchema.parse(await normalResponse.json());
    const readyResponse = await app.request(
      await request({
        ...changes,
        event: "pull_request_metadata",
        event_reason: ["ready_for_review"],
        pr_draft: false,
      }),
    );
    const ready = ConfigResponseSchema.parse(await readyResponse.json());
    expect(ready.configs.map((entry) => entry.name)).toEqual(
      normal.configs.map((entry) => entry.name),
    );
    expect(ready.configs.some((entry) => entry.name.includes("tofu-pr"))).toBe(
      true,
    );
    expect(
      ready.configs.some((entry) => entry.name.includes("playwright-e2e")),
    ).toBe(true);
    const completion = ready.configs.find((entry) =>
      entry.name.endsWith("/ci-complete.yaml"),
    );
    expect(completion?.data).toContain(
      "ci/woodpecker/pull_request_metadata/verify",
    );
    expect(completion?.data).not.toContain("ci/woodpecker/pr/verify");
    const verify = ready.configs.find((entry) =>
      entry.name.endsWith("/verify.yaml"),
    );
    const normalVerify = normal.configs.find((entry) =>
      entry.name.endsWith("/verify.yaml"),
    );
    expect(verify?.data).toBe(normalVerify?.data);
    expect(ready.configs.map((entry) => entry.data).join("\n")).not.toContain(
      "SEAWEEDFS_SITES_ACCESS_KEY_ID",
    );
  });

  test.each([
    { event_reason: ["edited"] },
    { event_reason: ["label_updated"] },
    { event_reason: null },
    { event_reason: ["converted_to_draft"], pr_draft: true },
    { event_reason: ["ready_for_review"], pr_draft: true },
  ])(
    "keeps other metadata from producing merge evidence: %j",
    async (metadata) => {
      const { app, cancelSupersededPr } = harness(true, gateImage);
      const response = await app.request(
        await request({ event: "pull_request_metadata", ...metadata }),
      );
      const result = ConfigResponseSchema.parse(await response.json());
      expect(result.configs.map((entry) => entry.name)).toEqual([
        ".woodpecker/ci-noop.yaml",
      ]);
      expect(cancelSupersededPr).not.toHaveBeenCalled();
    },
  );
  test.each([[false, "ci-ready"]])(
    "routes a signed PR with draft=%s through all required pools",
    async (draft, priority) => {
      const { app } = harness(true, gateImage);
      const response = await app.request(await request({ pr_draft: draft }));
      expect(response.status).toBe(200);
      const result = ConfigResponseSchema.parse(await response.json());
      for (const [key, pool] of [
        ["verify", "pr"],
        ["codex-review-gate", "review"],
        ["ci-complete", "completion"],
      ] as const) {
        const config = result.configs.find(
          (entry) => entry.name === `.woodpecker/${key}.yaml`,
        );
        expect(config).toBeDefined();
        const workflow: unknown = parse(config?.data ?? "");
        expect(workflow).toMatchObject({
          labels: {
            backend: "kubernetes",
            "ci-pool": pool,
            "kueue.x-k8s.io/priority-class": priority,
          },
        });
      }
    },
  );

  test.each([false, true])(
    "draft preflight remains bounded and credentialless=%s",
    async (credentialless) => {
      const { app, base, cancelSupersededPr } = harness(false, gateImage);
      const identity = credentialless
        ? { author: "renovate[bot]", sender: "renovate[bot]" }
        : {};
      const response = await app.request(
        await request({ ...identity, pr_draft: true, changed_files: [] }),
      );
      const result = ConfigResponseSchema.parse(await response.json());
      expect(result.configs.map((entry) => entry.name)).toEqual([
        ".woodpecker/draft-preflight.yaml",
      ]);
      const config = result.configs[0];
      expect(config?.data).toContain("180s");
      expect(config?.data).toContain("--ignore-scripts");
      expect(config?.data.match(/--filter /gu)).toHaveLength(2);
      expect(config?.data).toContain("@shepherdjerred/monorepo");
      expect(config?.data).toContain("@shepherdjerred/root-scripts");
      expect(config?.data).not.toContain("--production");
      expect(config?.data).not.toContain("TURBO_TOKEN");
      expect(config?.data).not.toContain("GITHUB_REVIEW_TOKEN");
      if (credentialless) {
        expect(config?.data).not.toContain("secrets:");
        expect(config?.data).not.toContain("volumes:");
      }
      expect(parse(config?.data ?? "")).toMatchObject({
        labels: {
          "ci-pool": "pr",
          "kueue.x-k8s.io/priority-class": "ci-draft",
        },
      });
      expect(base).not.toHaveBeenCalled();
      expect(cancelSupersededPr).toHaveBeenCalledTimes(credentialless ? 0 : 1);
    },
  );

  test("keeps metadata no-ops out of the completion pool", async () => {
    const { app } = harness(true, gateImage);
    const response = await app.request(
      await request({ event: "pull_request_metadata" }),
    );
    const result = ConfigResponseSchema.parse(await response.json());
    expect(result.configs).toHaveLength(1);
    const workflow: unknown = parse(result.configs[0]?.data ?? "");
    expect(workflow).toMatchObject({ labels: { "ci-pool": "pr" } });
  });
});

describe("hosted Renovate pipeline authorization", () => {
  const renovate = {
    author: "renovate[bot]",
    sender: "renovate[bot]",
    changed_files: ["package.json", "bun.lock"],
  };

  test("ready metadata preserves the exact-head approval boundary", async () => {
    const { app } = harness(false);
    const response = await app.request(
      await request({
        ...renovate,
        event: "pull_request_metadata",
        event_reason: ["ready_for_review"],
        pr_draft: false,
      }),
    );
    const result = ConfigResponseSchema.parse(await response.json());
    expect(result.configs.map((entry) => entry.name).sort()).toEqual([
      ".woodpecker/semgrep.yaml",
      ".woodpecker/trivy.yaml",
      ".woodpecker/verify.yaml",
    ]);
    expect(result.configs.map((entry) => entry.data).join("\n")).not.toContain(
      "secrets:",
    );
  });

  test("emits only credentialless verification before exact-head approval", async () => {
    const { app, base } = harness(false);
    const response = await app.request(await request(renovate));
    expect(response.status).toBe(200);
    const result = ConfigResponseSchema.parse(await response.json());
    expect(result.configs.map((config) => config.name).sort()).toEqual([
      ".woodpecker/semgrep.yaml",
      ".woodpecker/trivy.yaml",
      ".woodpecker/verify.yaml",
    ]);
    const emitted = result.configs.map((config) => config.data).join("\n");
    expect(emitted).not.toContain("secrets:");
    expect(emitted).not.toContain("TURBO_TOKEN");
    expect(emitted).not.toContain("ci-complete");
    expect(base).not.toHaveBeenCalled();
  });

  test("emits the normal reviewed PR graph after exact-head approval", async () => {
    const { app, base } = harness(true);
    const response = await app.request(await request(renovate));
    expect(response.status).toBe(200);
    const result = ConfigResponseSchema.parse(await response.json());
    expect(result.configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: ".woodpecker/verify.yaml" }),
        expect.objectContaining({ name: ".woodpecker/ci-complete.yaml" }),
      ]),
    );
    expect(base).toHaveBeenCalled();
  });
});
