import { beforeAll, expect, test } from "vitest";
import { App } from "cdk8s";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import { staticSites } from "@shepherdjerred/homelab/cdk8s/src/resources/s3-static-sites/sites.ts";
import {
  applicationReleasePolicy,
  ORDINARY_DELIVERY_ENVIRONMENTS,
  STATIC_BUCKET_RELEASE_POLICIES,
  INDEPENDENT_STATIC_BUCKET_OWNERS,
} from "homelab/src/delivery-target-policy.ts";
import {
  DELIVERY_ACTIVE_DELEGATIONS,
  DELIVERY_DELEGATION_DEFINITIONS,
  DELIVERY_ENVIRONMENT_ANNOTATION,
} from "homelab/src/delivery-ownership.ts";
import { STATIC_SITE_DELIVERY_OWNERS } from "homelab/src/static-site-delivery-ownership.ts";
import storagePolicy from "homelab/src/delivery-storage-policy.json";
import { STATIC_ARCHIVE_BUCKET } from "@shepherdjerred/root-scripts/lib/static-site-publication.ts";
import { V1_ENVIRONMENT_RENAMES } from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";

const registrations = new URL(
  "../../../../../../delivery/registrations/",
  import.meta.url,
);
const root = fileURLToPath(new URL("../../../", registrations));
const ApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});
const CACHE_ZONES: Readonly<Record<string, string>> = {
  "better-skill-capped.com": "3584931497b83f9359a3cc2983cc5cb4",
  "glitter-boys.com": "ec9aaac18b0aae64b456e54773d11e66",
  "scout-for-lol.com": "bc4593740e6621ab2e64799c63441bfd",
  "sjer.red": "879487f81194d63121d0b8dddd16f08f",
  "statically-typed.com": "d4036b55fca60ca5f998866309e951d8",
  "ts-mc.net": "efb999158b3977e07b26f6a74809c80a",
};
let app: App;
beforeAll(async () => {
  app = new App();
  await setupCharts(app);
});

test("every rendered Application and every catalog application has a reviewed release owner", () => {
  const rendered = app.charts
    .flatMap((chart) => z.array(z.unknown()).parse(chart.toJson()))
    .map((manifest) => ApplicationSchema.safeParse(manifest))
    .filter((result) => result.success)
    .map((result) => result.data);
  expect(rendered.length).toBeGreaterThan(0);
  for (const application of rendered) {
    expect(applicationReleasePolicy(application.metadata.name)).toBeDefined();
    expect(
      application.metadata.annotations?.[DELIVERY_ENVIRONMENT_ANNOTATION],
    ).toBe(DELIVERY_ACTIVE_DELEGATIONS[application.metadata.name]);
  }
  for (const service of SERVICE_CATALOG.services)
    for (const name of service.argoApps)
      expect(applicationReleasePolicy(name)).toBeDefined();
  for (const [name, environment] of Object.entries(DELIVERY_ACTIVE_DELEGATIONS))
    expect(DELIVERY_DELEGATION_DEFINITIONS[name]).toBe(environment);
  expect(Object.keys(DELIVERY_ACTIVE_DELEGATIONS)).toHaveLength(19);
  expect(DELIVERY_ACTIVE_DELEGATIONS).not.toHaveProperty(
    "glitter-boys-launcher",
  );
  expect(DELIVERY_DELEGATION_DEFINITIONS["glitter-boys-launcher"]).toBe(
    "glitter-boys-launcher/prod",
  );
  expect(() => applicationReleasePolicy("unreviewed-application")).toThrow(
    /explicit release-owner/u,
  );
  expect(applicationReleasePolicy("apps")).toMatchObject({
    owner: "release-root",
  });
  expect(applicationReleasePolicy("argocd")).toMatchObject({
    owner: "release-root",
  });
});

test("ordinary application registrations match their reviewed delegation definitions", async () => {
  const applications: string[] = [];
  for (const [name, environmentId] of Object.entries(
    ORDINARY_DELIVERY_ENVIRONMENTS,
  )) {
    const file = Bun.file(
      new URL(
        name === "arcade"
          ? "arcade.environment.json"
          : `ordinary/${name}/environment.json`,
        registrations,
      ),
    );
    if (!(await file.exists())) {
      // A retired v1 registration (X4) is carried onto its catalog successor.
      expect(V1_ENVIRONMENT_RENAMES[environmentId], name).toBeDefined();
      expect(DELIVERY_DELEGATION_DEFINITIONS[name]).toBe(environmentId);
      continue;
    }
    const environment = z
      .object({ id: z.string(), application: z.string() })
      .parse(await file.json());
    expect(environment).toMatchObject({ id: environmentId, application: name });
    expect(DELIVERY_DELEGATION_DEFINITIONS[name]).toBe(environmentId);
    applications.push(environment.application);
  }
  expect(new Set(applications).size).toBe(applications.length);
});

test("every served static bucket has one pipeline or an explicit independent writer", async () => {
  expect(storagePolicy.archiveBucket).toBe(STATIC_ARCHIVE_BUCKET);
  const pipelines: {
    bucket: string;
    cloudflareZoneId: string;
    verification: { url: string };
  }[] = [];
  for await (const file of new Bun.Glob("**/pipeline.json").scan({
    cwd: fileURLToPath(registrations),
  })) {
    const definition = z
      .looseObject({
        kind: z.string(),
        scoutSite: z.unknown().optional(),
      })
      .parse(await Bun.file(new URL(file, registrations)).json());
    const policy =
      definition.kind === "static-site" ? definition : definition.scoutSite;
    if (policy === undefined) continue;
    pipelines.push(
      z
        .object({
          bucket: z.string(),
          cloudflareZoneId: z.string(),
          verification: z.object({ url: z.string() }),
        })
        .parse(policy),
    );
  }
  // Per-site registrations are retired (X4): each site is its own catalog
  // service, carried from its v1 environment onto `<bucket>/prod`. Only
  // Scout's site steps remain in v1 registrations.
  expect(pipelines.map((pipeline) => pipeline.bucket).sort()).toEqual([
    "scout-frontend",
    "scout-frontend-beta",
  ]);
  const registered = Object.keys(STATIC_BUCKET_RELEASE_POLICIES).sort();
  expect(registered).toEqual([...storagePolicy.siteBuckets].sort());
  expect(registered).toHaveLength(15);
  for (const bucket of registered) {
    if (bucket.startsWith("scout-frontend")) continue;
    const environmentId = STATIC_BUCKET_RELEASE_POLICIES[bucket] ?? "";
    expect(V1_ENVIRONMENT_RENAMES[environmentId], bucket).toBe(
      `${bucket}/prod`,
    );
  }
  for (const stage of ["beta", "prod"]) {
    const environment = z
      .object({ id: z.string() })
      .parse(
        await Bun.file(
          new URL(`specialized/scout-${stage}/environment.json`, registrations),
        ).json(),
      );
    const bucket = stage === "prod" ? "scout-frontend" : "scout-frontend-beta";
    expect(STATIC_BUCKET_RELEASE_POLICIES[bucket]).toBe(environment.id);
    expect(
      await Bun.file(
        new URL(`static/${bucket}/environment.json`, registrations),
      ).exists(),
    ).toBe(false);
  }
  expect(
    [...registered, ...Object.keys(INDEPENDENT_STATIC_BUCKET_OWNERS)].sort(),
  ).toEqual(staticSites.map((site) => site.bucket).sort());
  for (const pipeline of pipelines) {
    const site = staticSites.find((entry) => entry.bucket === pipeline.bucket);
    if (site === undefined)
      throw new Error(`Unserved site bucket ${pipeline.bucket}`);
    expect(pipeline.verification.url).toBe(`https://${site.hostname}/`);
    const zone = Object.entries(CACHE_ZONES)
      .filter(
        ([domain]) =>
          site.hostname === domain || site.hostname.endsWith(`.${domain}`),
      )
      .sort(([a], [b]) => b.length - a.length)[0];
    expect(zone).toBeDefined();
    expect(pipeline.cloudflareZoneId).toBe(zone?.[1]);
  }
  expect(STATIC_SITE_DELIVERY_OWNERS).toEqual(STATIC_BUCKET_RELEASE_POLICIES);
  expect(Object.keys(STATIC_SITE_DELIVERY_OWNERS).sort()).toEqual(registered);
  for (const bucket of Object.keys(INDEPENDENT_STATIC_BUCKET_OWNERS))
    expect(STATIC_SITE_DELIVERY_OWNERS).not.toHaveProperty(bucket);
  const child = Bun.spawn(["bun", "scripts/release/deploy-site.ts", "--list"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, stderr).toBe(0);
  const producerBuckets = stdout
    .trim()
    .split("\n")
    .map((line) => z.string().parse(line.split("\t")[1]))
    .sort();
  expect(producerBuckets).toEqual(
    registered.filter(
      (bucket) => !["scout-frontend", "scout-frontend-beta"].includes(bucket),
    ),
  );
});
