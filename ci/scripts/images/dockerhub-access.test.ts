import { expect, test } from "vitest";
import { ensureDockerHubAccess } from "./dockerhub-access.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

const digest = `sha256:${"a".repeat(64)}`;
const noWait = { attempts: 1, sleeper: async () => 0 };
const isToken = (url: string | URL) =>
  new URL(url).hostname === "auth.docker.io";

test("accepts a private image only when anonymous manifest access is denied", async () => {
  const requested: string[] = [];
  await ensureDockerHubAccess("birmel", digest, {
    ...noWait,
    fetcher: async (url, init) => {
      requested.push(String(url));
      if (isToken(url)) {
        expect(init?.headers).toBeUndefined();
        return Response.json({ token: "anonymous-fixture" });
      }
      return new Response(null, { status: 401 });
    },
  });
  expect(requested).toEqual([
    "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Ashepherdjerred%2Fbirmel%3Apull",
    `https://registry-1.docker.io/v2/shepherdjerred/birmel/manifests/${digest}`,
  ]);
});

test("fails closed when a private image becomes public", async () => {
  await expect(
    ensureDockerHubAccess("birmel", digest, {
      ...noWait,
      fetcher: async (url) =>
        isToken(url)
          ? Response.json({ token: "anonymous-fixture" })
          : Response.json({}),
    }),
  ).rejects.toThrow("Private Docker Hub image birmel is anonymously pullable");
});

test.each([
  "macos-cross-compiler",
  "windows-cross-compiler",
  "windows-cross-compiler-winui",
])("requires public compiler %s to be anonymously readable", async (name) => {
  await ensureDockerHubAccess(name, digest, {
    ...noWait,
    fetcher: async (url) =>
      isToken(url)
        ? Response.json({ token: "anonymous-fixture" })
        : Response.json({}),
  });
  await expect(
    ensureDockerHubAccess(name, digest, {
      ...noWait,
      fetcher: async () => new Response(null, { status: 401 }),
    }),
  ).rejects.not.toBeInstanceOf(TransientError);
});

test("retries propagation failures for public manifests", async () => {
  let manifests = 0;
  let sleeps = 0;
  await ensureDockerHubAccess("windows-cross-compiler", digest, {
    attempts: 3,
    sleeper: async () => {
      sleeps += 1;
    },
    fetcher: async (url) => {
      if (isToken(url)) return Response.json({ token: "anonymous-fixture" });
      manifests += 1;
      return new Response(null, { status: manifests < 3 ? 404 : 200 });
    },
  });
  expect(manifests).toBe(3);
  expect(sleeps).toBe(2);
});

test.each([408, 429, 500, 503])(
  "preserves transient registry status %s",
  async (status) => {
    await expect(
      ensureDockerHubAccess("birmel", digest, {
        ...noWait,
        fetcher: async () => new Response(null, { status }),
      }),
    ).rejects.toBeInstanceOf(TransientError);
  },
);

test("does not include arbitrary transport diagnostics in errors", async () => {
  const failure: unknown = await ensureDockerHubAccess("birmel", digest, {
    ...noWait,
    fetcher: async () => {
      throw new Error("credential-bearing-fixture");
    },
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TransientError);
  expect(failure instanceof Error ? failure.message : "").not.toContain(
    "credential-bearing-fixture",
  );
});

test("rejects unknown repositories and malformed digests before sending requests", async () => {
  let requests = 0;
  const options = {
    ...noWait,
    fetcher: async () => {
      requests += 1;
      return Response.json({});
    },
  };
  await expect(
    ensureDockerHubAccess("unknown", digest, options),
  ).rejects.toThrow("Unregistered image");
  await expect(
    ensureDockerHubAccess("birmel", "latest", options),
  ).rejects.toThrow("Invalid image digest");
  expect(requests).toBe(0);
});

test.each([{}, { token: "" }])(
  "rejects an unusable anonymous token body",
  async (body) => {
    await expect(
      ensureDockerHubAccess("birmel", digest, {
        ...noWait,
        fetcher: async () => Response.json(body),
      }),
    ).rejects.toBeInstanceOf(TransientError);
  },
);

test("preserves an incomplete public manifest response as a transport failure", async () => {
  class TruncatedResponse extends Response {
    override arrayBuffer = async (): Promise<ArrayBuffer> => {
      throw new Error("stream closed");
    };
  }
  await expect(
    ensureDockerHubAccess("windows-cross-compiler", digest, {
      ...noWait,
      fetcher: async (url) =>
        isToken(url)
          ? Response.json({ token: "anonymous-fixture" })
          : new TruncatedResponse(null),
    }),
  ).rejects.toBeInstanceOf(TransientError);
});
