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
  ["app", "get", "my-app", "--help", "--timeout", "5"],
  ["app", "get", "my-app", "--help", "--refresh"],
  ["app", "get", "my-app", "-h", "--output=json"],
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
  ["app", "get", "my-app", "--help", "--timeout", "5", "--help=false"],
  ["app", "get", "my-app", "--help", "--refresh", "-h=0"],
  ["app", "set", "my-app", "--help", "--parameter", "--server", "--help=false"],
  ["app", "set", "my-app", "--help", "--parameter", "--", "--help=false"],
])(
  "preserves authentication for values, false help and payloads: %j",
  (...args) => {
    expect(isArgoHelpCommand(args)).toBe(false);
  },
);
