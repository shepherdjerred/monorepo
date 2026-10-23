import { expect, test, vi } from "vitest";
import { zipSync } from "fflate";
import { trmnlPluginArchiveFixture } from "@shepherdjerred/ops-model/trmnl/plugin-archive-fixture.ts";
import { createTrmnlPluginClient, trmnlPluginMatches } from "./trmnl.ts";
import { readTrmnlArchive, inspectTrmnlArchive } from "./trmnl-archive.ts";

function encodeZip(files: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [
        name,
        new TextEncoder().encode(value),
      ]),
    ),
  );
}
const SOURCE_REVISION = "a".repeat(40);
function fixture() {
  const { bundle, bytes, digest, uri } =
    trmnlPluginArchiveFixture(SOURCE_REVISION);
  const artifact = { uri, digest, sourceRevision: SOURCE_REVISION };
  return {
    bundle,
    bytes,
    artifact,
    zip: encodeZip,
    plugin: bundle.plugins[0]!,
  };
}
test("fixed archive API writes only selected IDs, inspects ambiguous responses before another write, and compares YAML semantically", async () => {
  const { plugin, zip } = fixture();
  let remote: Record<string, string> = {
    ...plugin.files,
    "full.liquid": "old bytes",
  };
  const transport = vi.fn(async (url, init) => {
    expect(url).toBe(
      `https://trmnl.com/api/plugin_settings/${String(plugin.id)}/archive`,
    );
    expect(init?.headers).toEqual({
      authorization: "Bearer disposable-trmnl-test-token",
    });
    if (init?.method === "POST") {
      expect(init.body).toBeInstanceOf(FormData);
      remote = { ...plugin.files };
      throw new Error(
        "Response lost after the exact dependency configuration was stored",
      );
    }
    return new Response(zip(remote));
  });
  const client = createTrmnlPluginClient({
    token: "disposable-trmnl-test-token",
    fetch: transport,
  });
  expect(await client.matches(plugin)).toBe(false);
  await expect(client.publish(plugin)).rejects.toThrow("Response lost");
  expect(await client.matches(plugin)).toBe(true);
  expect(
    transport.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(
    trmnlPluginMatches(plugin, {
      ...plugin.files,
      "settings.yml": `strategy: polling\nid: ${String(plugin.id)}\nserver_managed: extra\n`,
    }),
  ).toBe(true);
  expect(
    trmnlPluginMatches(plugin, {
      ...plugin.files,
      "settings.yml": `id: ${String(plugin.id)}\nstrategy: webhook\n`,
    }),
  ).toBe(false);
  await expect(client.publish({ ...plugin, id: 999_999 })).rejects.toThrow(
    "fixed dependency",
  );
});
test("archive observation rejects unknown entries, expanded ZIP bombs and wrong settings identities without leaking upstream bodies", async () => {
  const { plugin, zip } = fixture();
  for (const files of [
    { ...plugin.files, "../foreign": "bad" },
    { ...plugin.files, "full.liquid": "a".repeat(2 * 1024 * 1024 + 1) },
    { ...plugin.files, "settings.yml": "id: 999999\n" },
  ]) {
    const client = createTrmnlPluginClient({
      token: "disposable-trmnl-test-token",
      fetch: async () => new Response(zip(files)),
    });
    await expect(client.matches(plugin)).rejects.toThrow();
  }
  const unavailable = createTrmnlPluginClient({
    token: "disposable-trmnl-test-token",
    fetch: async () =>
      new Response("sensitive upstream diagnostic", { status: 403 }),
  });
  await expect(unavailable.matches(plugin)).rejects.not.toThrow(
    "sensitive upstream diagnostic",
  );
});
test("small upstream ZIP64 archives are bounded by actual output even when central sizes are sentinel values", async () => {
  const { plugin, zip } = fixture();
  const bytes = zip(plugin.files);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let changed = 0;
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02_01_4b_50) continue;
    view.setUint32(offset + 20, 0xff_ff_ff_ff, true);
    view.setUint32(offset + 24, 0xff_ff_ff_ff, true);
    changed++;
  }
  expect(changed).toBe(6);
  const client = createTrmnlPluginClient({
    token: "disposable-trmnl-test-token",
    fetch: async () => new Response(bytes),
  });
  expect(await client.matches(plugin)).toBe(true);
});
test("independent inspector binds exact content address and original source before GET-only readback of all three fixed plugins", async () => {
  const { artifact, bytes, bundle } = fixture();
  const matches = vi.fn<
    (plugin: ReturnType<typeof fixture>["plugin"]) => Promise<boolean>
  >(async () => true);
  const inspected = await inspectTrmnlArchive(artifact, {
    readArchive: async () => bytes,
    client: { matches },
  });
  expect(inspected.pluginCount).toBe(3);
  expect(matches.mock.calls.map(([plugin]) => plugin.id)).toEqual(
    bundle.plugins.map((plugin) => plugin.id),
  );
  for (const changed of [
    { ...artifact, uri: "s3://delivery-artifacts/elsewhere.json" },
    { ...artifact, sourceRevision: "b".repeat(40) },
    { ...artifact, digest: `sha256:${"0".repeat(64)}` },
  ])
    await expect(
      readTrmnlArchive(changed, async () => bytes),
    ).rejects.toThrow();
  await expect(
    inspectTrmnlArchive(artifact, {
      readArchive: async () => bytes,
      client: { matches: async () => false },
    }),
  ).rejects.toThrow("frozen archive");
});
test("v2 archives bind their content digest alone; the descriptor's source revision is not compared", async () => {
  const { bundle: v2, bytes, digest, uri } = trmnlPluginArchiveFixture();
  const artifact = { uri, digest, sourceRevision: "b".repeat(40) };
  await expect(readTrmnlArchive(artifact, async () => bytes)).resolves.toEqual(
    v2,
  );
  const other = "0".repeat(64);
  await expect(
    readTrmnlArchive(
      {
        ...artifact,
        uri: `s3://delivery-artifacts/trmnl-plugins/${other}.json`,
        digest: `sha256:${other}`,
      },
      async () => bytes,
    ),
  ).rejects.toThrow("differ from their qualified original digest");
});
