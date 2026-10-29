import { expect, test } from "vitest";
import { githubAuthenticatedTransport } from "./upstream-source.ts";

function recorder() {
  const seen: { url: string; authorization: string | null }[] = [];
  const transport = (url: string | URL, init?: RequestInit) => {
    seen.push({
      url: url.toString(),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Promise.resolve(new Response("ok"));
  };
  return { seen, transport };
}

test("GitHub tag and tarball reads carry the read credential", async () => {
  const { seen, transport } = recorder();
  const authenticated = githubAuthenticatedTransport("t0ken", transport);
  await authenticated(
    "https://api.github.com/repos/adyanth/cloudflare-operator/commits/v0.13.1",
    { headers: { accept: "application/vnd.github.sha" } },
  );
  await authenticated(
    new URL(
      "https://codeload.github.com/adyanth/cloudflare-operator/tar.gz/abc",
    ),
  );
  expect(seen.map((entry) => entry.authorization)).toEqual([
    "Bearer t0ken",
    "Bearer t0ken",
  ]);
});

test("other upstream hosts never receive the GitHub credential", async () => {
  const { seen, transport } = recorder();
  await githubAuthenticatedTransport(
    "t0ken",
    transport,
  )("https://charts.jetstack.io/index.yaml");
  expect(seen[0]?.authorization).toBeNull();
});

test("without a credential the transport is unchanged", () => {
  const { transport } = recorder();
  expect(githubAuthenticatedTransport(undefined, transport)).toBe(transport);
});
