import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

// A newer published apps chart means a newer build owns the release (#3126):
// this build records a superseded receipt and succeeds. A chart that is not
// yet published is still a hard failure. Neither path may touch Argo CD.
async function reconcileAgainst(publishedVersion: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  argoRequests: number;
}> {
  let argoRequests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/charts/apps") {
        return Response.json([
          {
            version: publishedVersion,
            urls: [`charts/apps-${publishedVersion}.tgz`],
            digest: "a".repeat(64),
          },
        ]);
      }
      argoRequests++;
      return new Response("unexpected Argo request", { status: 500 });
    },
  });
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(
    expectedPath,
    JSON.stringify([
      { name: "apps", revision: "2.0.0-42" },
      { name: "worker", revision: "2.0.0-42" },
    ]),
  );

  try {
    const process = Bun.spawn(
      [
        "bun",
        "--no-install",
        "scripts/argocd/argocd.ts",
        "reconcile-release",
        expectedPath,
        "--timeout",
        "1",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...Bun.env,
          ARGOCD_SERVER_URL: server.url.origin,
          ARGOCD_TOKEN: "test-token",
          CHARTMUSEUM_ORIGIN: server.url.origin,
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, argoRequests };
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}

describe("Argo CD release freshness", () => {
  test("records a superseded release when a newer apps chart is published", async () => {
    const result = await reconcileAgainst("2.0.0-43");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Apps release 2.0.0-42 is superseded by 2.0.0-43; the newer build owns this release",
    );
    expect(result.argoRequests).toBe(0);
  });

  test("refuses a release whose apps chart is not yet published", async () => {
    const result = await reconcileAgainst("2.0.0-41");

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Apps release 2.0.0-42 is not published; newest published apps revision is 2.0.0-41",
    );
    expect(result.argoRequests).toBe(0);
  });
});
