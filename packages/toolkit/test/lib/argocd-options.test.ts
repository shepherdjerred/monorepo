import { expect, test } from "vitest";
import { protectArgoTokenDefault } from "#lib/argocd-options.ts";

test.each([
  "",
  "--loglevel debug",
  "--grpc-web-root-path=/--auth-token",
  "--header 'X-Debug: --auth-token disabled'",
  '--header "X-Debug: --auth-token disabled"',
  String.raw`--header X-Debug:\ --auth-token\ disabled`,
  String.raw`--header "X-Debug: \q --auth-token disabled"`,
  "--header 'X-Text: $USER `literal` # no expansion'",
  "--loglevel info\\\n --grpc-web",
  "\\\n--grpc-web",
  "--header ''",
  "--header X-Value:\r--auth-token",
])(
  "preserves native options without interpreting shell syntax: %s",
  (options) => {
    expect(protectArgoTokenDefault(options)).toBe(
      `--auth-token "" ${options}`.trimEnd(),
    );
  },
);

test.each([
  "--auth-token synthetic",
  "--auth-token=synthetic",
  "'--auth-token' synthetic",
  '"--auth-token" synthetic',
  "--auth-'token' synthetic",
  String.raw`--auth-to\ken synthetic`,
  "--auth-\\\ntoken synthetic",
  '--auth-"token=synthetic"',
  '--auth-"to\\\nken" synthetic',
  "--header foo --auth-token synthetic",
])(
  "rejects actual token defaults, including quoted and escaped names: %s",
  (options) => {
    expect(() => protectArgoTokenDefault(options)).toThrow(
      "use ARGOCD_AUTH_TOKEN instead",
    );
    try {
      protectArgoTokenDefault(options);
    } catch (error) {
      expect(String(error)).not.toContain("synthetic");
    }
  },
);

test.each([
  "--header 'synthetic",
  '--header "synthetic',
  "--header synthetic\\",
])("rejects malformed quoting without echoing the value: %s", (options) => {
  expect(() => protectArgoTokenDefault(options)).toThrow(
    "toolkit: malformed ARGOCD_OPTS quoting",
  );
});
