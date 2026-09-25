import { expect, test } from "vitest";
import { registryLoginCommand } from "../images/build-ci-image-core.ts";

test("does not log in without a token", () => {
  expect(registryLoginCommand()).toBeUndefined();
  expect(registryLoginCommand("")).toBeUndefined();
});

test("passes the token through stdin rather than argv", () => {
  expect(registryLoginCommand("secret")).toEqual([
    "docker",
    "login",
    "ghcr.io",
    "-u",
    "shepherdjerred",
    "--password-stdin",
  ]);
});
