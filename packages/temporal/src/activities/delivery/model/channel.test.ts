import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { RecipeDefinitionSchema } from "@shepherdjerred/delivery/model-contract";
import {
  NPM_STAGING_TAG,
  npmRegistry,
  packagePath,
  type Packument,
} from "#lib/delivery/model/npm-registry.ts";
import { modelSteps } from "#lib/delivery/model/recipe.ts";
import {
  artifact,
  detail as arcadeDetail,
} from "#lib/delivery/model/testing.ts";
import { runChannelStep, type ChannelEffects } from "./channel.ts";

const BYTES = new TextEncoder().encode("webring-1.12.0 tarball");
const OTHER = new TextEncoder().encode("webring-1.11.0 tarball");
const sha256 = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const definition = {
  kind: "channel",
  store: "npm",
  name: "webring",
  pointer: "latest",
  forwardOnly: false,
  artifactComponent: "archive:webring-package",
};

function webring(
  stages: { key: string; status: "running" | "succeeded" }[] = [],
  store = "npm",
): DeploymentDetail {
  const tarball = {
    ...artifact({
      id: "archive/webring-1.12.0",
      component: "archive:webring-package",
      kind: "archive",
      uri: "s3://delivery-artifacts/npm/webring-1.12.0.tgz",
      version: "1.12.0",
      character: "a",
    }),
    digest: sha256(BYTES),
  };
  const base = arcadeDetail({ ...definition, store }, tarball, stages);
  return DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      environmentId: "webring/latest",
      serviceId: "webring",
      kind: "channel-publish",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "webring",
      components: { "archive:webring-package": tarball },
    },
  });
}

/** An in-memory registry; `published` maps a version to the bytes it serves. */
function registry(
  published: Record<string, Uint8Array>,
  tags: Record<string, string>,
) {
  const calls: string[] = [];
  const packument = (): Packument => ({
    "dist-tags": { ...tags },
    versions: Object.fromEntries(
      Object.entries(published).map(([version, bytes]) => [
        version,
        {
          dist: {
            integrity: `sha512-${version}`,
            shasum: createHash("sha1").update(bytes).digest("hex"),
            tarball: `https://registry.npmjs.org/webring/-/webring-${version}.tgz`,
          },
        },
      ]),
    ),
  });
  const effects: ChannelEffects = {
    record: async (_current, key, status) => {
      calls.push(`record ${key} ${status}`);
    },
    artifact: async () => {
      calls.push("artifact");
      return BYTES;
    },
    registry: {
      packument: async () => packument(),
      tarball: async (url) => {
        const version = /webring-([\d.]+)\.tgz$/u.exec(url)?.[1] ?? "";
        const bytes = published[version];
        if (bytes === undefined) throw new Error(`No tarball ${url}`);
        return bytes;
      },
      setTag: async (_name, tag, version) => {
        calls.push(`tag ${tag} ${version}`);
        tags[tag] = version;
      },
      removeTag: async (_name, tag) => {
        calls.push(`untag ${tag}`);
        Reflect.deleteProperty(tags, tag);
      },
    },
    publish: async (bytes, tag) => {
      calls.push(`publish ${tag}`);
      published["1.12.0"] = bytes;
      tags[tag] = "1.12.0";
    },
    wait: async () => {
      calls.push("wait");
    },
  };
  return { calls, effects, tags };
}

const channel = RecipeDefinitionSchema.parse(definition);
if (channel.kind !== "channel") throw new Error("webring is a channel recipe");
const PUBLISH = { key: "step-publish", phase: "publish" } as const;
const POINTER = { key: "step-pointer", phase: "pointer" } as const;

describe("npm channel (section 5, X12)", () => {
  test("publishes under the staging tag, then moves latest and drops the staging tag", async () => {
    const run = registry({ "1.11.0": OTHER }, { latest: "1.11.0" });
    await runChannelStep(webring(), channel, PUBLISH, run.effects);
    await runChannelStep(webring(), channel, POINTER, run.effects);
    expect(run.calls).toEqual([
      "record step-publish running",
      "artifact",
      `publish ${NPM_STAGING_TAG}`,
      "record step-publish succeeded",
      "record step-pointer running",
      "tag latest 1.12.0",
      `untag ${NPM_STAGING_TAG}`,
      "record step-pointer succeeded",
    ]);
    expect(run.tags).toEqual({ latest: "1.12.0" });
  });

  test("a rollback finds its version published and only moves the pointer back", async () => {
    const run = registry(
      { "1.12.0": BYTES, "1.13.0": OTHER },
      { latest: "1.13.0" },
    );
    await runChannelStep(webring(), channel, PUBLISH, run.effects);
    await runChannelStep(webring(), channel, POINTER, run.effects);
    expect(run.calls).toEqual([
      "record step-publish succeeded",
      "record step-pointer running",
      "tag latest 1.12.0",
      "record step-pointer succeeded",
    ]);
  });

  test("a resumed publish whose version already landed never publishes again", async () => {
    const run = registry({ "1.12.0": BYTES }, { [NPM_STAGING_TAG]: "1.12.0" });
    await runChannelStep(
      webring([{ key: "step-publish", status: "running" }]),
      channel,
      PUBLISH,
      run.effects,
    );
    expect(run.calls).toEqual(["record step-publish succeeded"]);
  });

  test("a version the registry serves with other bytes is refused, never replaced", async () => {
    const run = registry({ "1.12.0": OTHER }, { latest: "1.12.0" });
    await expect(
      runChannelStep(webring(), channel, PUBLISH, run.effects),
    ).rejects.toThrow(/never replaced/u);
    expect(run.calls).toEqual([]);
  });

  test("other stores stay missing adapters", async () => {
    const hub = RecipeDefinitionSchema.parse({
      ...definition,
      store: "docker-hub",
      artifactComponent: "image:webring",
    });
    if (hub.kind !== "channel") throw new Error("a channel recipe");
    await expect(
      runChannelStep(
        webring([], "docker-hub"),
        hub,
        PUBLISH,
        registry({}, {}).effects,
      ),
    ).rejects.toMatchObject({ type: "DeliveryModelAdapterMissing" });
  });

  test("a channel recipe freezes a publish step, then a pointer step", () => {
    expect(modelSteps(channel)).toEqual([
      { key: "step-publish", adapter: "channel", phase: "publish" },
      { key: "step-pointer", adapter: "channel", phase: "pointer" },
    ]);
  });
});

describe("npm registry client", () => {
  test("escapes a scope's slash and refuses other names", () => {
    expect(packagePath("@shepherdjerred/webring")).toBe(
      "@shepherdjerred%2Fwebring",
    );
    expect(() => packagePath("../webring")).toThrow(/not an npm package name/u);
  });

  test("moves a dist-tag with the channel credential and needs one to write", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const client = npmRegistry({
      token: "npm-token",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return new Response(null, { status: 200 });
      },
    });
    await client.setTag("webring", "latest", "1.12.0");
    expect(requests).toEqual([
      {
        url: "https://registry.npmjs.org/-/package/webring/dist-tags/latest",
        init: expect.objectContaining({
          method: "PUT",
          body: '"1.12.0"',
          headers: expect.objectContaining({
            authorization: "Bearer npm-token",
          }),
        }),
      },
    ]);
    await expect(
      npmRegistry({ token: undefined }).setTag("webring", "latest", "1.12.0"),
    ).rejects.toThrow(/credential is not configured/u);
  });
});
