import { expect, test } from "vitest";
import { isArgoHelpCommand } from "#lib/argocd-metadata.ts";

test.each([
  ["--loglevel", "debug"],
  ["--server", "help"],
  ["--config", "/tmp/config"],
  ["--grpc-web=false"],
  ["-H", "X-Value: help"],
  ["-HX-Value:help"],
])(
  "accepts inherited options at every help-path position: %j",
  (...options) => {
    const command = ["app", "rollback", "--help"];
    for (let index = 0; index <= command.length; index += 1) {
      const args = [
        ...command.slice(0, index),
        ...options,
        ...command.slice(index),
      ];
      expect(isArgoHelpCommand(args)).toBe(true);
    }
  },
);

test.each([
  ["app", "get", "foo.bar", "--help"],
  ["app", "--help", "rollback"],
  ["app", "list", "--help=false", "--help"],
  ["app", "--help", "--", "--help=false"],
])("recognizes explicit help before the payload boundary: %j", (...args) => {
  expect(isArgoHelpCommand(args)).toBe(true);
});

test.each([
  ["app", "list", "--help", "--help=false"],
  ["--help", "app", "list", "-h=0"],
  ["app", "get", "help", "--header", "--help"],
  ["app", "set", "example", "--parameter", "--help"],
  ["app", "--", "--help", "--loglevel", "debug"],
  ["app", "get", "help", "--loglevel=debug"],
])(
  "preserves authentication for values, false help and payloads: %j",
  (...args) => {
    expect(isArgoHelpCommand(args)).toBe(false);
  },
);
