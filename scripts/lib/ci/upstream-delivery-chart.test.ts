import { createHash } from "node:crypto";
import { packTar } from "modern-tar";
import { expect, test } from "vitest";
import { mirrorMinecraftChart } from "./upstream-delivery-chart.ts";

const version = "5.2.0";
const archiveUrl = "https://chartmuseum.sjer.red/charts/minecraft-5.2.0.tgz";
const credentials = { username: "fixture", password: "fixture-password" };
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function fixture(
  options: {
    existing?: "same" | "different";
    corrupt?: boolean;
    archiveVersion?: string;
    race?: boolean;
  } = {},
) {
  const body = `name: minecraft\nversion: ${options.archiveVersion ?? version}\n`;
  const bytes = Bun.gzipSync(
    await packTar([
      {
        header: {
          name: "minecraft/Chart.yaml",
          type: "file",
          size: Buffer.byteLength(body),
        },
        body,
      },
    ]),
  );
  const calls: { url: string; method: string; authorization: string | null }[] =
    [];
  let uploaded = false;
  const transport = async (url: string | URL, init?: RequestInit) => {
    const location = String(url);
    calls.push({
      url: location,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (location.endsWith("/index.yaml"))
      return Response.json({
        entries: {
          minecraft: [
            {
              name: "minecraft",
              version,
              digest: options.corrupt === true ? "0".repeat(64) : digest(bytes),
              urls: [
                "https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-5.2.0/minecraft-5.2.0.tgz",
              ],
            },
          ],
        },
      });
    if (location.startsWith("https://github.com/")) return new Response(bytes);
    if (location === archiveUrl) {
      if (options.existing === "different")
        return new Response("conflicting mirror bytes");
      return uploaded || options.existing === "same"
        ? new Response(bytes)
        : new Response(null, { status: 404 });
    }
    if (
      location === "https://chartmuseum.sjer.red/api/charts" &&
      init?.method === "POST"
    ) {
      expect(
        digest(new Uint8Array(await new Response(init.body).arrayBuffer())),
      ).toBe(digest(bytes));
      uploaded = true;
      return new Response(null, { status: options.race === true ? 409 : 201 });
    }
    throw new Error(`Unexpected request ${location}`);
  };
  return { calls, transport };
}

test.each([false, true])(
  "verifies exact upstream bytes and reads back the published mirror (race: %s)",
  async (race) => {
    const { calls, transport } = await fixture({ race });
    const result = await mirrorMinecraftChart(version, credentials, transport);
    expect(result).toMatchObject({ name: "minecraft", revision: version });
    expect(result.origin).toEqual({
      kind: "upstream",
      repository: "https://itzg.github.io/minecraft-server-charts/",
      name: "minecraft",
      version,
      checksum: result.digest,
    });
    expect(result.uri).toBe(archiveUrl);
    expect(calls.at(-1)?.url).toBe(archiveUrl);
    expect(calls.filter((call) => call.authorization !== null)).toEqual([
      {
        url: "https://chartmuseum.sjer.red/api/charts",
        method: "POST",
        authorization: `Basic ${btoa("fixture:fixture-password")}`,
      },
    ]);
  },
);

test("an existing identical mirror needs no write", async () => {
  const { calls, transport } = await fixture({ existing: "same" });
  await mirrorMinecraftChart(version, credentials, transport);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test.each([
  [{ corrupt: true }, "checksum mismatch"],
  [{ archiveVersion: "5.1.0" }, "5.2.0"],
  [{ existing: "different" as const }, "conflicts"],
])(
  "a corrupt or conflicting chart never overwrites the mirror: %s",
  async (options, reason) => {
    const { calls, transport } = await fixture(options);
    await expect(
      mirrorMinecraftChart(version, credentials, transport),
    ).rejects.toThrow(reason);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  },
);
