import { afterEach, describe, expect, test, vi } from "vitest";
import { zipSync } from "fflate";
import {
  DeploymentDetailSchema,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { trmnlPluginArchiveFixture } from "@shepherdjerred/ops-model/trmnl/plugin-archive-fixture.ts";
import { createTrmnlPluginClient } from "@shepherdjerred/ops-clients/trmnl.ts";
import { artifact, detail, recipe } from "#lib/delivery/model/testing.ts";
import { applyPluginArchive, type ArchiveStepEffects } from "./archive.ts";

const KEY = "step-archive";
const { bundle, bytes, digest, uri } = trmnlPluginArchiveFixture();
const archive = {
  ...artifact({
    id: "archive/trmnl",
    component: "archive:trmnl-plugins",
    kind: "archive",
    uri: "",
    version: "plugins",
    character: "c",
  }),
  uri,
  digest,
};
const chart = artifact({
  id: "chart/1",
  component: "chart:arcade",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});

function zip(files: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [
        name,
        new TextEncoder().encode(value),
      ]),
    ),
  );
}

let remote: Map<number, Record<string, string>>;
let events: string[];
let recorded: { key: string; status: string; evidence: EvidenceInput[] }[];
let lostResponses: number;

function current(stages: { key: string; status: "running" }[] = []) {
  const value = detail(
    recipe(
      { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
      "chart:arcade",
    ),
    chart,
    stages,
  );
  return DeploymentDetailSchema.parse({
    ...value,
    versionSet: {
      ...value.versionSet,
      components: {
        ...value.versionSet.components,
        [archive.component]: archive,
      },
    },
  });
}

function effects(
  readArchive: ArchiveStepEffects["readArchive"] = () => Promise.resolve(bytes),
): ArchiveStepEffects {
  const transport = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : url.toString();
      const id = Number(/plugin_settings\/(\d+)\//u.exec(href)?.[1]);
      await Promise.resolve();
      if (init?.method === "POST") {
        events.push(`publish ${String(id)}`);
        const plugin = bundle.plugins.find((entry) => entry.id === id);
        if (plugin !== undefined) remote.set(id, plugin.files);
        if (lostResponses > 0) {
          lostResponses -= 1;
          throw new Error("Response lost after the write");
        }
        return new Response("ok");
      }
      const stale = bundle.plugins.find((entry) => entry.id === id)?.files;
      return new Response(
        zip(remote.get(id) ?? { ...stale, "full.liquid": "old" }),
      );
    },
  );
  return {
    client: createTrmnlPluginClient({ token: "test-token", fetch: transport }),
    readArchive,
    record: async (_current, key, status, input) => {
      events.push(`${key} ${status}`);
      recorded.push({ key, status, evidence: input.evidence ?? [] });
      await Promise.resolve();
    },
    owned: async () => current(),
    signal: new AbortController().signal,
  };
}

function reset() {
  remote = new Map();
  events = [];
  recorded = [];
  lostResponses = 0;
}
reset();
afterEach(reset);

describe("plugin archive step", () => {
  test("writes only differing settings, each after its own sub-step intent, and accepts on a full readback", async () => {
    const [first, second, third] = bundle.plugins;
    remote.set(second!.id, second!.files);
    const evidence = await applyPluginArchive(
      current(),
      archive.component,
      KEY,
      effects(),
    );
    expect(events).toEqual([
      `${KEY} running`,
      `${KEY}/plugin-${String(first!.id)} running`,
      `publish ${String(first!.id)}`,
      `${KEY}/plugin-${String(first!.id)} succeeded`,
      `${KEY}/plugin-${String(second!.id)} succeeded`,
      `${KEY}/plugin-${String(third!.id)} running`,
      `publish ${String(third!.id)}`,
      `${KEY}/plugin-${String(third!.id)} succeeded`,
      `${KEY} succeeded`,
    ]);
    expect(JSON.parse(evidence.at(-1)?.summary ?? "")).toEqual({
      adapter: "trmnl-plugins",
      archiveArtifactId: archive.id,
      archiveDigest: digest,
      versionSetRevisionId: "version/1",
      pluginCount: 3,
    });
  });

  test("an ambiguous write leaves its sub-step running; the resumed step re-reads and never repeats a settled write", async () => {
    lostResponses = 1;
    await expect(
      applyPluginArchive(current(), archive.component, KEY, effects()),
    ).rejects.toThrow("Response lost");
    const first = bundle.plugins[0]!;
    expect(recorded.at(-1)).toMatchObject({
      key: `${KEY}/plugin-${String(first.id)}`,
      status: "running",
    });
    events = [];
    await applyPluginArchive(
      current([{ key: KEY, status: "running" }]),
      archive.component,
      KEY,
      effects(),
    );
    expect(events.filter((event) => event.startsWith("publish"))).toEqual(
      bundle.plugins.slice(1).map((plugin) => `publish ${String(plugin.id)}`),
    );
    expect(events).not.toContain(`${KEY} running`);
    expect(events.at(-1)).toBe(`${KEY} succeeded`);
  });

  test("archive bytes that differ from the frozen digest stop before any intent or write", async () => {
    await expect(
      applyPluginArchive(current(), archive.component, KEY, {
        ...effects(() => Promise.resolve(new TextEncoder().encode("{}"))),
      }),
    ).rejects.toThrow("differ from their qualified original digest");
    expect(events).toEqual([]);
  });

  test("a selection without the frozen archive is refused", async () => {
    await expect(
      applyPluginArchive(current(), "archive:missing", KEY, effects()),
    ).rejects.toThrow("Selection lacks the frozen plugin archive");
  });
});
