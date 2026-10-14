import { expect, test } from "vitest";
import { dockerHubLogin } from "./dockerhub-env.ts";

test("requires an explicitly granted publisher credential", async () => {
  await expect(dockerHubLogin("publisher", {})).rejects.toThrow();
});

test("passes the publisher credential through stdin", async () => {
  const calls: { command: readonly string[]; password: string }[] = [];
  await dockerHubLogin(
    "publisher",
    {
      DOCKERHUB_USERNAME: "shepherdjerred",
      DOCKERHUB_PUBLISH_TOKEN: "test-token",
    },
    (command, password) => {
      calls.push({ command, password });
      return Promise.resolve(0);
    },
  );
  expect(calls).toEqual([
    {
      command: [
        "docker",
        "login",
        "docker.io",
        "--username",
        "shepherdjerred",
        "--password-stdin",
      ],
      password: "test-token",
    },
  ]);
});
