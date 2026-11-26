import { expect, test } from "vitest";
import { z } from "zod";
import {
  LEGACY_MEDIA_ROUTES,
  MEDIA_INGRESS_PRUNE_FLAG,
  MEDIA_INGRESS_PRUNE_INFO,
  mediaIngressSourceHash,
  parseMediaIngressPruning,
} from "homelab/scripts/argocd/argocd-media-ingress-prunes.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { runArgocdCommand } from "@shepherdjerred/homelab/cdk8s/src/argocd-script-support.ts";

const homelabRoot = new URL("../../../../", import.meta.url).pathname;
const revision = "2.0.0-42";
const requestId = "11111111-1111-4111-8111-111111111111";
const source = {
  repoURL: "https://charts.tailnet-1a49.ts.net",
  chart: "media",
  targetRevision: revision,
  helm: {
    parameters: [
      { name: "delivery.image", value: "frozen", forceString: true },
    ],
  },
};
const resources = LEGACY_MEDIA_ROUTES.map((app) => ({
  group: "networking.k8s.io",
  kind: "Ingress",
  name: `media-${app}-tailscale-ingress-ingress`,
  namespace: "media",
  uid: `uid-${app}`,
}));
const expected = {
  applicationUid: "media-application-uid",
  sourceHash: mediaIngressSourceHash(source),
  resources,
};
const head = "/api/v1/applications/media";
const live = resources.map(({ uid, ...identity }) => ({
  ...identity,
  liveState: JSON.stringify({
    metadata: {
      uid,
      annotations: {
        "argocd.argoproj.io/tracking-id": `media:networking.k8s.io/Ingress:media/${identity.name}`,
      },
    },
  }),
}));
const SyncRequest = z.object({
  revision: z.literal(revision),
  prune: z.literal(true),
  infos: z.array(z.object({ name: z.string(), value: z.string() })),
  resources: z.never().optional(),
});

test.each([
  "matches",
  "extra PVC",
  "new UID",
  "new tracking",
  "one removed",
  "source changed",
  "Application replaced",
])(
  "Media prune compares the original proof to the last immutable check when the inventory %s",
  async (change) => {
    const fresh = structuredClone(live);
    if (change === "extra PVC")
      fresh.push({
        group: "",
        kind: "PersistentVolumeClaim",
        name: "legacy-pvc",
        namespace: "media",
        liveState: "{}",
      });
    if (change === "new UID")
      fresh[0]!.liveState = fresh[0]!.liveState.replace(
        "uid-bazarr",
        "uid-new",
      );
    if (change === "new tracking")
      fresh[0]!.liveState = fresh[0]!.liveState.replace(
        "media:networking.k8s.io",
        "foreign:networking.k8s.io",
      );
    if (change === "one removed") fresh.pop();
    let operation:
      | {
          info: { name: string; value: string }[];
          sync: { revision: string; prune: boolean };
        }
      | undefined;
    const reads: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const action = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
        reads.push(`${request.method} ${action}${url.search}`);
        if (url.pathname === `${head}/managed-resources`)
          return Response.json({ items: fresh });
        if (url.pathname === `${head}/manifests`)
          return Response.json({ manifests: [] });
        if (url.pathname === `${head}/sync`) {
          const body = SyncRequest.parse(await request.json());
          const proofs = body.infos.filter(
            ({ name }) => name === MEDIA_INGRESS_PRUNE_INFO,
          );
          expect(
            proofs.map(({ value }) => parseMediaIngressPruning(value)),
          ).toEqual([expected]);
          operation = { info: body.infos, sync: { revision, prune: true } };
          return Response.json({ operation });
        }
        return Response.json({
          metadata: {
            name: "media",
            uid:
              change === "Application replaced" && url.search !== ""
                ? "replacement-uid"
                : expected.applicationUid,
            annotations: {
              [DELIVERY_ENVIRONMENT_ANNOTATION]: "streambot/prod",
            },
          },
          spec: {
            destination: { namespace: "media" },
            source:
              change === "source changed"
                ? { ...source, helm: { parameters: [] } }
                : source,
          },
          status:
            operation === undefined
              ? {}
              : {
                  sync: { status: "Synced", revision },
                  health: { status: "Healthy" },
                  operationState: {
                    phase: "Succeeded",
                    operation,
                    syncResult: { revision },
                  },
                },
        });
      },
    });
    try {
      const result = await runArgocdCommand(
        [
          "bun",
          "run",
          "./scripts/argocd/argocd.ts",
          "sync-managed",
          "media",
          "--revision",
          revision,
          "--request-id",
          requestId,
          "--prune",
          MEDIA_INGRESS_PRUNE_FLAG,
          JSON.stringify(expected),
          "--timeout",
          "1",
        ],
        {
          cwd: homelabRoot,
          env: {
            PATH: Bun.env["PATH"],
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
          },
        },
      );
      expect(reads.slice(0, 4)).toEqual([
        "GET media",
        "GET media?refresh=hard",
        "GET managed-resources",
        `GET manifests?revision=${revision}`,
      ]);
      if (change === "matches") {
        expect(result.exitCode, result.stderr).toBe(0);
        expect(reads.filter((read) => read === "POST sync")).toHaveLength(1);
      } else {
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(/changed before sync/u);
        expect(reads).not.toContain("POST sync");
      }
    } finally {
      await server.stop(true);
    }
  },
);

test.each([true, false])(
  "a completed Media prune is never submitted again (same Application: %s)",
  async (sameApplication) => {
    let syncPosts = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        if (request.method === "POST") {
          syncPosts++;
          return new Response("unexpected sync", { status: 400 });
        }
        if (pathname === `${head}/managed-resources`)
          return Response.json({ items: [] });
        if (pathname === `${head}/manifests`)
          return Response.json({ manifests: [] });
        return Response.json({
          metadata: {
            name: "media",
            uid: sameApplication ? expected.applicationUid : "replacement-uid",
            annotations: {
              [DELIVERY_ENVIRONMENT_ANNOTATION]: "streambot/prod",
            },
          },
          spec: { destination: { namespace: "media" }, source },
          status: {
            operationState: {
              phase: "Succeeded",
              operation: {
                info: [
                  { name: "ci.sjer.red/request-id", value: requestId },
                  {
                    name: "ci.sjer.red/operation-id",
                    value: "22222222-2222-4222-8222-222222222222",
                  },
                  {
                    name: MEDIA_INGRESS_PRUNE_INFO,
                    value: JSON.stringify(expected),
                  },
                ],
                sync: { revision, prune: true },
              },
              syncResult: { revision },
            },
          },
        });
      },
    });
    try {
      const result = await runArgocdCommand(
        [
          "bun",
          "run",
          "./scripts/argocd/argocd.ts",
          "sync-managed",
          "media",
          "--revision",
          revision,
          "--request-id",
          requestId,
          "--timeout",
          "1",
        ],
        {
          cwd: homelabRoot,
          env: {
            PATH: Bun.env["PATH"],
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
          },
        },
      );
      expect(result.exitCode, result.stderr).toBe(sameApplication ? 0 : 1);
      expect(syncPosts).toBe(0);
      if (sameApplication)
        expect(result.stdout).toContain(
          "sync operation already finished: media",
        );
      else
        expect(result.stderr).toContain("does not match its completed scope");
    } finally {
      await server.stop(true);
    }
  },
);
