import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import { createStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import { requireModelRecipe, modelSteps } from "#lib/delivery/model/recipe.ts";
import { artifact, detail } from "#lib/delivery/model/testing.ts";
import type { StaticSiteIo } from "#activities/delivery/static-site.ts";
import type { StaticActivationReceipt } from "#activities/delivery/static-site-effects.ts";
import {
  runStaticSiteStep,
  type StaticSiteStepEffects,
} from "./static-site.ts";

const KEY = "step-static-site";
/** Reviewed ownership names the v1 environment; the catalog calls it `wiki-sjer-red/prod`. */
const OWNERS = { "wiki-sjer-red": "static-sites/wiki-sjer-red" };
const ENVIRONMENT = "wiki-sjer-red/prod";
const HTML = "<html>exact selected release</html>";

let directory: string;
let archiveFile: string;
let bucket: Map<string, string>;
let receipt: StaticActivationReceipt | null;
let publicReceipt: () => unknown;
let events: string[];
let recorded: { key: string; status: string; evidence: EvidenceInput[] }[];

function io(): StaticSiteIo {
  return {
    download: async (uri, file) => {
      events.push(`download ${uri}`);
      await Bun.write(file, Bun.file(archiveFile));
    },
    readReceipt: () => Promise.resolve(receipt),
    writeReceipt: (value) => {
      events.push("receipt");
      receipt = value;
      return Promise.resolve();
    },
    firstMismatch: async ({ source, paths }) => {
      for (const file of paths)
        if (
          (await Bun.file(path.join(source, file)).text()) !== bucket.get(file)
        )
          return file;
      return;
    },
    synchronize: async ({ source, site }) => {
      events.push(`sync ${site.bucket}`);
      for (const file of await readdir(source))
        bucket.set(file, await Bun.file(path.join(source, file)).text());
    },
    fetch: (input, init) => {
      const url = new URL(input);
      if (init.method === "POST") {
        events.push("purge");
        return Promise.resolve(Response.json({ success: true }));
      }
      return Promise.resolve(
        url.pathname === "/.delivery-release.json"
          ? Response.json(publicReceipt())
          : new Response(bucket.get("index.html") ?? "", { status: 200 }),
      );
    },
    cloudflareToken: () => "purge-only",
  };
}

function effects(): StaticSiteStepEffects {
  const controller = new AbortController();
  return {
    io: io(),
    owners: OWNERS,
    record: async (_current, key, status, input) => {
      events.push(`${key} ${status}`);
      recorded.push({ key, status, evidence: input.evidence ?? [] });
      await Promise.resolve();
    },
    owned: async (id) => {
      events.push(`owned ${id}`);
      await Promise.resolve();
    },
    run: async (operation) =>
      await operation({ signal: controller.signal, heartbeat: vi.fn() }),
  };
}

async function fixture(stages: { key: string; status: "running" }[] = []) {
  const source = path.join(directory, "source");
  await Bun.write(path.join(source, "index.html"), HTML);
  const { digest } = await createStaticArchive(source, archiveFile);
  const archive = {
    ...artifact({
      id: "archive/wiki",
      component: "archive:wiki-sjer-red",
      kind: "archive",
      uri: "",
      version: "wiki",
      character: "c",
    }),
    uri: `s3://delivery-artifacts/sites/wiki-sjer-red/${digest.slice(7)}.tar`,
    digest,
  };
  const fixed = detail(
    {
      kind: "static-site",
      archiveComponent: "archive:wiki-sjer-red",
      bucket: "wiki-sjer-red",
      cloudflareZoneId: "1".repeat(32),
      verification: { url: "https://wiki.sjer.red/", expectedStatus: 200 },
    },
    archive,
    stages,
  );
  // The site's own catalog environment, which reviewed ownership delegates.
  const current = {
    ...fixed,
    deployment: { ...fixed.deployment, environmentId: ENVIRONMENT },
    environment: { ...fixed.environment, id: ENVIRONMENT },
  };
  const recipe = requireModelRecipe(current);
  const [step] = modelSteps(recipe);
  if (step?.adapter !== "static-site")
    throw new Error("A static-site recipe freezes one static-site step");
  return { current, step, archive };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "model-static-site-"));
  archiveFile = path.join(directory, "selected.tar");
  bucket = new Map();
  receipt = null;
  publicReceipt = () => receipt;
  events = [];
  recorded = [];
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("static-site step", () => {
  test("a standalone recipe runs as one model step keyed by its kind", async () => {
    const { step } = await fixture();
    expect(step.key).toBe(KEY);
    expect(step.policy.bucket).toBe("wiki-sjer-red");
  });

  test("records intent before syncing the archive fetched by digest, then reads back bucket, entrypoints and receipt", async () => {
    const { current, step, archive } = await fixture();
    await runStaticSiteStep(current, step.policy, KEY, effects());
    expect(events).toEqual([
      `download ${archive.uri}`,
      `owned ${current.deployment.id}`,
      `${KEY} running`,
      "sync wiki-sjer-red",
      "receipt",
      "purge",
      `${KEY} succeeded`,
    ]);
    expect(receipt).toEqual({
      deploymentId: current.deployment.id,
      versionSetRevisionId: current.versionSet.id,
      archiveDigest: archive.digest,
      bucket: "wiki-sjer-red",
    });
    const settled = recorded.at(-1);
    expect(settled?.evidence.map((entry) => entry.kind)).toEqual([
      "reconciliation",
      "runtime",
      "acceptance",
      "acceptance",
    ]);
    expect(JSON.parse(settled?.evidence.at(-1)?.summary ?? "")).toEqual({
      adapter: "static-site",
      archiveArtifactId: archive.id,
      archiveDigest: archive.digest,
      versionSetRevisionId: current.versionSet.id,
      bucket: "wiki-sjer-red",
    });
  });

  test("a resumed step whose bucket already holds this deployment re-records its intent and re-proves it without syncing", async () => {
    const first = await fixture();
    await runStaticSiteStep(first.current, first.step.policy, KEY, effects());
    events = [];
    const resumed = await fixture([{ key: KEY, status: "running" }]);
    await runStaticSiteStep(
      resumed.current,
      resumed.step.policy,
      KEY,
      effects(),
    );
    expect(events).toEqual([
      `download ${resumed.archive.uri}`,
      `owned ${resumed.current.deployment.id}`,
      `${KEY} running`,
      "purge",
      `${KEY} succeeded`,
    ]);
  });

  test("a resumed step whose lease lapsed is refused at its intent before any bucket, receipt or purge effect (D7)", async () => {
    const resumed = await fixture([{ key: KEY, status: "running" }]);
    const live = effects();
    await expect(
      runStaticSiteStep(resumed.current, resumed.step.policy, KEY, {
        ...live,
        // The server refuses any stage write once the lease has lapsed.
        record: async (current, key, status, input) => {
          if (status === "running")
            throw new Error(
              "The deployment's lease lapsed; it is no longer provably owned and ends in recovery (D7)",
            );
          await live.record(current, key, status, input);
        },
      }),
    ).rejects.toThrow(/lease lapsed/u);
    expect(events).toEqual([
      `download ${resumed.archive.uri}`,
      `owned ${resumed.current.deployment.id}`,
    ]);
    expect(bucket.size).toBe(0);
    expect(receipt).toBeNull();
    expect(recorded).toEqual([]);
  });

  test("a resumed step that no longer owns its environment stops before any bucket effect", async () => {
    const resumed = await fixture([{ key: KEY, status: "running" }]);
    await expect(
      runStaticSiteStep(resumed.current, resumed.step.policy, KEY, {
        ...effects(),
        owned: () =>
          Promise.reject(
            new Error("Deployment no longer owns its environment"),
          ),
      }),
    ).rejects.toThrow(/no longer owns/u);
    expect(events).toEqual([`download ${resumed.archive.uri}`]);
    expect(bucket.size).toBe(0);
  });

  test("corrupt archive bytes stop before intent or any bucket effect", async () => {
    const { current, step } = await fixture();
    await Bun.write(archiveFile, "corrupt archive");
    await expect(
      runStaticSiteStep(current, step.policy, KEY, effects()),
    ).rejects.toThrow("checksum differs");
    expect(recorded).toEqual([]);
    expect(bucket.size).toBe(0);
  });

  test("a public receipt naming another deployment leaves the intent unsettled for recovery", async () => {
    const { current, step } = await fixture();
    publicReceipt = () => ({ ...receipt, deploymentId: "another/deployment" });
    await expect(
      runStaticSiteStep(current, step.policy, KEY, effects()),
    ).rejects.toThrow("different activation receipt");
    expect(recorded.map((entry) => `${entry.key} ${entry.status}`)).toEqual([
      `${KEY} running`,
    ]);
  });

  test("a bucket reviewed infrastructure delegates to another environment is refused before any read", async () => {
    const { current, step } = await fixture();
    await expect(
      runStaticSiteStep(current, step.policy, KEY, {
        ...effects(),
        owners: { "wiki-sjer-red": "static-sites/sjer-red" },
      }),
    ).rejects.toThrow(
      "Static bucket wiki-sjer-red is delegated to sjer-red/prod, not wiki-sjer-red/prod",
    );
    expect(events).toEqual([]);
  });

  test("a bucket reviewed infrastructure does not delegate is refused before any read", async () => {
    const { current, step } = await fixture();
    await expect(
      runStaticSiteStep(current, step.policy, KEY, {
        ...effects(),
        owners: {},
      }),
    ).rejects.toThrow("not delegated");
    expect(events).toEqual([]);
  });
});
