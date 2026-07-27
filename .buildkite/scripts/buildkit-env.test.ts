import { expect, test } from "bun:test";
import { registryLoginCommand } from "./migration-core.ts";

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
