import { afterEach, expect, test } from "vitest";
import { KubeConfig } from "@kubernetes/client-node";
import { DELIVERY_MINECRAFT_REPORT_READER as reader } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { kubernetesReportAuthorizer } from "./minecraft-controller-report-auth.ts";

const requestId = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const caller = "system:serviceaccount:delivery:delivery-forum-observer";
const servers: { stop: (force?: boolean) => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

/** A local API server answering TokenReview and SubjectAccessReview. */
function apiServer(answers: {
  authenticated: boolean;
  audiences: string[];
  allowed: boolean;
}) {
  const reviews: { path: string; body: unknown }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body: unknown = await request.json();
      reviews.push({ path, body });
      if (path === "/apis/authentication.k8s.io/v1/tokenreviews")
        return Response.json({
          apiVersion: "authentication.k8s.io/v1",
          kind: "TokenReview",
          status: {
            authenticated: answers.authenticated,
            audiences: answers.audiences,
            user: {
              username: caller,
              uid: "api-account-uid",
              groups: ["system:serviceaccounts"],
            },
          },
        });
      if (path === "/apis/authorization.k8s.io/v1/subjectaccessreviews")
        return Response.json({
          apiVersion: "authorization.k8s.io/v1",
          kind: "SubjectAccessReview",
          status: { allowed: answers.allowed },
        });
      return new Response("unexpected", { status: 404 });
    },
  });
  servers.push(server);
  const config = new KubeConfig();
  config.loadFromOptions({
    clusters: [
      { name: "fixture", server: server.url.origin, skipTLSVerify: true },
    ],
    users: [{ name: "fixture" }],
    contexts: [{ name: "fixture", cluster: "fixture", user: "fixture" }],
    currentContext: "fixture",
  });
  return { authorize: kubernetesReportAuthorizer(config), reviews };
}

test("admits an audience-bound token whose subject may get exactly this report", async () => {
  const api = apiServer({
    authenticated: true,
    audiences: [reader.audience],
    allowed: true,
  });
  await expect(api.authorize("reader-token", requestId)).resolves.toBe(true);
  expect(api.reviews).toEqual([
    {
      path: "/apis/authentication.k8s.io/v1/tokenreviews",
      body: expect.objectContaining({
        spec: { token: "reader-token", audiences: [reader.audience] },
      }),
    },
    {
      path: "/apis/authorization.k8s.io/v1/subjectaccessreviews",
      body: expect.objectContaining({
        spec: expect.objectContaining({
          user: caller,
          uid: "api-account-uid",
          groups: ["system:serviceaccounts"],
          resourceAttributes: {
            namespace: "delivery-tsmc-controller",
            verb: "get",
            group: "delivery.shepherdjerred.com",
            resource: "minecraftrecoveryreports",
            name: requestId,
          },
        }),
      }),
    },
  ]);
});

test("refuses API-server tokens, unauthenticated tokens and subjects RBAC does not grant", async () => {
  // An empty audience list means the token is valid only for the API server.
  const generic = apiServer({
    authenticated: true,
    audiences: [],
    allowed: true,
  });
  await expect(generic.authorize("executor-token", requestId)).resolves.toBe(
    false,
  );
  expect(generic.reviews).toHaveLength(1);
  const forged = apiServer({
    authenticated: false,
    audiences: [reader.audience],
    allowed: true,
  });
  await expect(forged.authorize("forged", requestId)).resolves.toBe(false);
  expect(forged.reviews).toHaveLength(1);
  const ungranted = apiServer({
    authenticated: true,
    audiences: [reader.audience],
    allowed: false,
  });
  await expect(ungranted.authorize("reader-token", requestId)).resolves.toBe(
    false,
  );
  expect(ungranted.reviews).toHaveLength(2);
});
