import { createHash, generateKeyPairSync } from "node:crypto";
import { createSigner, httpbis } from "http-message-signatures";
import { describe, expect, test, vi } from "vitest";
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

function harness() {
  const imageFetcher = vi.fn((file: string) =>
    Promise.resolve(
      file.endsWith("catalog.json") ? catalog : `sha256:${"a".repeat(64)}`,
    ),
  );
  const base = vi.fn(() => Promise.resolve(undefined));
  const app = createApp({
    publicKey: () => Promise.resolve(publicKey),
    imageFetcher,
    changedBase: base,
    verifyBase: base,
    imageReleaseBase: base,
  });
  return { app, imageFetcher, base };
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
    const { app, imageFetcher, base } = harness();
    const response = await app.request(await request(overrides));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "actor is not permitted to run CI",
    });
    expect(imageFetcher).not.toHaveBeenCalled();
    expect(base).not.toHaveBeenCalled();
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
