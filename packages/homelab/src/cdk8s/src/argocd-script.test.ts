import { describe, expect, test } from "bun:test";
import path from "node:path";

type RequestObservation = {
  authorization: string | null;
  contentType: string | null;
  method: string;
  path: string;
  query: string;
};

describe("Argo CD operator script", () => {
  test("deletes an application within its project and waits for its disappearance", async () => {
    const requests: RequestObservation[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          contentType: request.headers.get("content-type"),
          method: request.method,
          path: url.pathname,
          query: url.searchParams.toString(),
        });

        if (request.method === "DELETE") {
          if (request.headers.get("content-type") !== "application/json") {
            return new Response("Invalid content type", { status: 415 });
          }
          if (url.searchParams.get("project") !== "default") {
            return new Response("permission denied", { status: 403 });
          }
          return new Response(null, { status: 204 });
        }
        if (request.method === "GET") {
          if (url.searchParams.get("project") !== "default") {
            return new Response("permission denied", { status: 403 });
          }
          return new Response("not found", { status: 404 });
        }
        return new Response("method not allowed", { status: 405 });
      },
    });

    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "delete-application",
          "kueue",
          "--project",
          "default",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
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

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("deleted: kueue");
      expect(requests).toEqual([
        {
          authorization: "Bearer test-token",
          contentType: "application/json",
          method: "DELETE",
          path: "/api/v1/applications/kueue",
          query: "cascade=true&propagationPolicy=foreground&project=default",
        },
        {
          authorization: "Bearer test-token",
          contentType: null,
          method: "GET",
          path: "/api/v1/applications/kueue",
          query: "project=default",
        },
      ]);
    } finally {
      await server.stop(true);
    }
  });

  test("treats a project-scoped missing application as already deleted", async () => {
    const requests: RequestObservation[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          contentType: request.headers.get("content-type"),
          method: request.method,
          path: url.pathname,
          query: url.searchParams.toString(),
        });
        return Response.json(
          {
            error: 'applications.argoproj.io "kueue" not found',
            code: 5,
          },
          { status: 404 },
        );
      },
    });

    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "delete-application",
          "kueue",
          "--project",
          "default",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
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

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("already deleted: kueue");
      expect(requests).toEqual([
        {
          authorization: "Bearer test-token",
          contentType: "application/json",
          method: "DELETE",
          path: "/api/v1/applications/kueue",
          query: "cascade=true&propagationPolicy=foreground&project=default",
        },
      ]);
    } finally {
      await server.stop(true);
    }
  });
});
