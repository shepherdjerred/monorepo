import { createHash } from "node:crypto";
import { packTar } from "modern-tar";
import { expect, test } from "vitest";
import {
  acquireUpstreamChart,
  helmRepositoryUrl,
} from "./upstream-delivery-chart.ts";

const version = "5.2.0";
const repository = "https://itzg.github.io/minecraft-server-charts/";
const upstreamArchive =
  "https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-5.2.0/minecraft-5.2.0.tgz";
const mirrorArchive = "https://chartmuseum.sjer.red/charts/minecraft-5.2.0.tgz";
const credentials = () => ({
  username: "fixture",
  password: "fixture-password",
});
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function chartBytes(name: string, chartVersion: string) {
  const body = `name: ${name}\nversion: ${chartVersion}\n`;
  return Bun.gzipSync(
    await packTar([
      {
        header: {
          name: `${name}/Chart.yaml`,
          type: "file",
          size: Buffer.byteLength(body),
        },
        body,
      },
    ]),
  );
}

async function fixture(
  options: {
    existing?: "same" | "different";
    corrupt?: boolean;
    archiveVersion?: string;
    race?: boolean;
    /** Index archive URL; relative values resolve against the repository. */
    archiveUrl?: string;
    duplicate?: boolean;
  } = {},
) {
  const bytes = await chartBytes(
    "minecraft",
    options.archiveVersion ?? version,
  );
  const calls: { url: string; method: string; authorization: string | null }[] =
    [];
  let uploaded = false;
  const entry = {
    name: "minecraft",
    version,
    digest: options.corrupt === true ? "0".repeat(64) : digest(bytes),
    urls: [options.archiveUrl ?? upstreamArchive],
  };
  const transport = async (url: string | URL, init?: RequestInit) => {
    const location = String(url);
    calls.push({
      url: location,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (location === `${repository}index.yaml`)
      return Response.json({
        entries: {
          minecraft: options.duplicate === true ? [entry, entry] : [entry],
          other: [{ ...entry, name: "other" }],
        },
      });
    if (
      location === upstreamArchive ||
      location === `${repository}charts/minecraft-5.2.0.tgz`
    )
      return new Response(bytes);
    if (location === mirrorArchive) {
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
  return { calls, transport, bytes };
}

test("normalises a catalog registryUrl to the Helm repository root and refuses plain HTTP", () => {
  expect(
    helmRepositoryUrl("https://itzg.github.io/minecraft-server-charts"),
  ).toBe(repository);
  expect(helmRepositoryUrl(repository)).toBe(repository);
  expect(() => helmRepositoryUrl("http://itzg.github.io/charts")).toThrow(
    "HTTPS",
  );
});

test.each([false, true])(
  "a mirrored chart verifies exact upstream bytes and reads back the published mirror (race: %s)",
  async (race) => {
    const { calls, transport, bytes } = await fixture({ race });
    const result = await acquireUpstreamChart(
      { name: "minecraft", version, repository },
      { mirror: true, credentials, transport },
    );
    expect(result).toMatchObject({ name: "minecraft", revision: version });
    expect(result.digest).toBe(`sha256:${digest(bytes)}`);
    expect(result.origin).toEqual({
      kind: "upstream",
      repository,
      name: "minecraft",
      version,
      checksum: result.digest,
    });
    expect(result.uri).toBe(mirrorArchive);
    expect(calls.at(-1)?.url).toBe(mirrorArchive);
    expect(calls.filter((call) => call.authorization !== null)).toEqual([
      {
        url: "https://chartmuseum.sjer.red/api/charts",
        method: "POST",
        authorization: `Basic ${btoa("fixture:fixture-password")}`,
      },
    ]);
  },
);

test("an unmirrored chart is identified by its upstream archive URL and never touches ChartMuseum or credentials", async () => {
  const { calls, transport, bytes } = await fixture();
  const result = await acquireUpstreamChart(
    {
      name: "minecraft",
      version,
      repository: "https://itzg.github.io/minecraft-server-charts",
    },
    {
      mirror: false,
      credentials: () => {
        throw new Error("Unmirrored charts need no publisher credentials");
      },
      transport,
    },
  );
  expect(result.uri).toBe(upstreamArchive);
  expect(result.digest).toBe(`sha256:${digest(bytes)}`);
  expect(result.origin.repository).toBe(repository);
  expect(calls.map((call) => call.url)).toEqual([
    `${repository}index.yaml`,
    upstreamArchive,
  ]);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("a relative index archive URL resolves against the repository", async () => {
  const { transport } = await fixture({
    archiveUrl: "charts/minecraft-5.2.0.tgz",
  });
  const result = await acquireUpstreamChart(
    { name: "minecraft", version, repository },
    { mirror: false, credentials, transport },
  );
  expect(result.uri).toBe(`${repository}charts/minecraft-5.2.0.tgz`);
});

test("an existing identical mirror needs no write", async () => {
  const { calls, transport } = await fixture({ existing: "same" });
  await acquireUpstreamChart(
    { name: "minecraft", version, repository },
    { mirror: true, credentials, transport },
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test.each([
  [{ corrupt: true }, "checksum mismatch"],
  [{ archiveVersion: "5.1.0" }, "5.2.0"],
  [{ existing: "different" as const }, "conflicts"],
  [{ duplicate: true }, "exactly once"],
  [{ archiveUrl: "http://example.invalid/minecraft-5.2.0.tgz" }, "HTTPS"],
])(
  "a corrupt, ambiguous or conflicting chart never overwrites the mirror: %s",
  async (options, reason) => {
    const { calls, transport } = await fixture(options);
    await expect(
      acquireUpstreamChart(
        { name: "minecraft", version, repository },
        { mirror: true, credentials, transport },
      ),
    ).rejects.toThrow(reason);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  },
);

test("a chart absent from the index or pinned to an invalid version is refused before any download", async () => {
  const { calls, transport } = await fixture();
  await expect(
    acquireUpstreamChart(
      { name: "absent", version, repository },
      { mirror: false, credentials, transport },
    ),
  ).rejects.toThrow("exactly once");
  expect(calls.map((call) => call.url)).toEqual([`${repository}index.yaml`]);
  await expect(
    acquireUpstreamChart(
      { name: "minecraft", version: "latest", repository },
      { mirror: false, credentials, transport },
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
