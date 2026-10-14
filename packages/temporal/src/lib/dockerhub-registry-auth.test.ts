import { expect, test } from "vitest";
import { dockerHubTokenHeaders } from "./dockerhub-registry-auth.ts";

const registry =
  "https://registry-1.docker.io/v2/shepherdjerred/birmel/manifests/sha256:abc";
const token = new URL(
  "https://auth.docker.io/token?service=registry.docker.io&scope=repository:shepherdjerred/birmel:pull",
);
const auth = Buffer.from("shepherdjerred:test-reader:with-colon").toString(
  "base64",
);
const environment = {
  DOCKERHUB_READ_CONFIG_JSON: JSON.stringify({
    auths: { "https://index.docker.io/v1/": { auth } },
  }),
};

test("authenticates only the exact first-party Docker Hub token exchange", () => {
  expect(dockerHubTokenHeaders(registry, token, environment)).toEqual({
    Authorization: `Basic ${auth}`,
  });
  for (const destination of [
    new URL(token.href.replace("auth.docker.io", "example.com")),
    new URL(token.href.replace("/token?", "/other?")),
    new URL(token.href.replace("birmel", "other")),
  ])
    expect(dockerHubTokenHeaders(registry, destination, environment)).toEqual(
      {},
    );
  expect(
    dockerHubTokenHeaders(
      registry.replace("shepherdjerred", "library"),
      token,
      environment,
    ),
  ).toEqual({});
  expect(
    dockerHubTokenHeaders(
      registry.replace("registry-1.docker.io", "example.com"),
      token,
      environment,
    ),
  ).toEqual({});
});

test("rejects missing or corrupt credentials without echoing their input", () => {
  for (const value of [
    undefined,
    "private-test-value",
    JSON.stringify({
      auths: { "https://index.docker.io/v1/": { auth: "private-test-value" } },
    }),
  ]) {
    expect(() =>
      dockerHubTokenHeaders(registry, token, {
        DOCKERHUB_READ_CONFIG_JSON: value,
      }),
    ).toThrow("Docker Hub reader credentials are missing or invalid");
  }
});
