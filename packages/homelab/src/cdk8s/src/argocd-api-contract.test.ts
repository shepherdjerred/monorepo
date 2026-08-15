import { expect, test } from "bun:test";
import path from "node:path";
import { serveIntroducedResourceLookup } from "./argocd-script-support.ts";
import {
  readArgocdApiContract,
  resourceOutsideApplicationMessage,
  type ArgocdApiContractCase,
} from "@shepherdjerred/homelab/cdk8s/scripts/argocd-api-contract.ts";

// Replays a recording of what ArgoCD actually answered through the real script.
// The original bug — "not part of this application" is a 400, not a 404 — was
// invisible to unit tests because every fake encoded the same belief the code
// did. An oracle that is a recording rather than a belief is the only thing
// that closes that class, so these tests drive the spawned script and never
// import the predicate directly.

const contract = await readArgocdApiContract();

function introducedResourceFor(contractCase: ArgocdApiContractCase) {
  const { query } = contractCase.request;
  const group = query["group"] ?? "";
  const version = query["version"] ?? "v1";
  return {
    apiVersion: group === "" ? version : `${group}/${version}`,
    kind: query["kind"] ?? "ConfigMap",
    name: query["resourceName"] ?? "unnamed",
    namespace: query["namespace"] ?? "worker",
  };
}

async function runSyncManagedAtRevision(origin: string) {
  const process = Bun.spawn(
    [
      "bun",
      "--no-install",
      "scripts/argocd.ts",
      "sync-managed",
      "worker",
      "--revision",
      "2.0.0-43",
      "--timeout",
      "1",
    ],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: {
        ...Bun.env,
        ARGOCD_SERVER_URL: origin,
        ARGOCD_TOKEN: "test-token",
        ARGOCD_POLL_INTERVAL_MS: "5",
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stderr };
}

// Every `resource` case, replayed through the preflight that reads it.
for (const contractCase of contract.cases.filter(
  (entry) => entry.endpoint === "resource",
)) {
  test(`contract case ${contractCase.name} is classified ${contractCase.expect}`, async () => {
    const resource = introducedResourceFor(contractCase);
    // The probe ran against a different Application than these tests drive, and
    // the message names it. Rebind it through the same formatter the script uses
    // — the recording pins the format, the application is a request parameter.
    // The self-consistency test below is what ties that formatter to what the
    // server actually sent.
    const body =
      contractCase.expect === "absent"
        ? (() => {
            const message = resourceOutsideApplicationMessage({
              ...contractCase,
              request: { ...contractCase.request, application: "worker" },
            });
            return { error: message, code: 3, message };
          })()
        : contractCase.response.body;
    const { server, syncPosts } = serveIntroducedResourceLookup({
      response: { status: contractCase.response.status, body },
      resource,
    });
    try {
      const { exitCode, stderr } = await runSyncManagedAtRevision(
        server.url.origin,
      );

      if (contractCase.expect === "absent") {
        // No live object means a creation, so the preflight has nothing to
        // check and the sync must go ahead.
        expect(stderr).not.toContain("Could not read live");
        expect(exitCode).toBe(0);
        expect(syncPosts()).toBe(1);
        return;
      }
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(
        `Could not read live ${resource.kind} ${resource.name} for worker`,
      );
      expect(stderr).toContain(
        `HTTP ${contractCase.response.status.toString()}`,
      );
      expect(syncPosts()).toBe(0);
    } finally {
      await server.stop(true);
    }
  });
}

// Every `application` case, replayed through getApplication.
for (const contractCase of contract.cases.filter(
  (entry) => entry.endpoint === "application",
)) {
  test(`contract case ${contractCase.name} fails loudly`, async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json(contractCase.response.body, {
          status: contractCase.response.status,
        });
      },
    });
    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "health-wait",
          "missing",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
            ARGOCD_POLL_INTERVAL_MS: "5",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(
        `returned HTTP ${contractCase.response.status.toString()}`,
      );
      if (contractCase.response.status === 403) {
        // A missing Application is a permission denial here, because ArgoCD
        // cannot resolve the project it would authorize against.
        expect(stderr).toContain("can mean the Application does not exist");
      }
    } finally {
      await server.stop(true);
    }
  });
}

test("the recorded absent-resource messages match the format the script rebuilds", () => {
  for (const contractCase of contract.cases.filter(
    (entry) => entry.expect === "absent",
  )) {
    const body = contractCase.response.body;
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? body.message
        : undefined;
    expect(message).toBe(resourceOutsideApplicationMessage(contractCase));
  }
});

test("the recorded contract covers every status the script branches on", () => {
  const statuses = new Set(
    contract.cases.map((entry) => entry.response.status),
  );
  // Dropping a probe from the refresher must fail the build rather than quietly
  // narrowing what is pinned.
  for (const status of [400, 403, 404, 500]) {
    expect(statuses).toContain(status);
  }
});

test("the recorded contract distinguishes absence from every other failure", () => {
  const absent = contract.cases.filter((entry) => entry.expect === "absent");
  const errors = contract.cases.filter((entry) => entry.expect === "error");

  // Absence is a 400 and so is nothing else recorded here; if a future ArgoCD
  // starts answering 400 for a real error too, the message check stops being
  // sufficient and this fails rather than silently swallowing it.
  expect(absent.length).toBeGreaterThan(0);
  expect(absent.every((entry) => entry.response.status === 400)).toBe(true);
  expect(errors.some((entry) => entry.response.status === 400)).toBe(false);
  // The core-group recording is the one that pins the double space.
  expect(
    absent.some((entry) => (entry.request.query["group"] ?? "") === ""),
  ).toBe(true);
});
