import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import {
  ciSecretItemId,
  collectErrors,
  collectSteps,
  type RequiredEnv,
  type SecretFields,
} from "./check-ci-env.ts";
import {
  assignedEnvNames,
  commandScopes,
  scriptPathsInCommand,
  structuralParens,
} from "./lib/ci-env-command.ts";

/** A secret that carries `names`, of which `blanks` are present but empty. */
function secretWith(
  names: readonly string[],
  blanks: readonly string[] = [],
): SecretFields {
  return {
    hasField: (name) => names.includes(name),
    isBlank: (name) => blanks.includes(name),
  };
}

function required(
  names: Record<string, string>,
  unresolved: string[] = [],
): RequiredEnv {
  return { names: new Map(Object.entries(names)), unresolved };
}

describe("assignedEnvNames", () => {
  test("reads both names from one multi-assignment export", () => {
    // pipeline.yml exports the two AWS names on a single line; missing the
    // second would report it as unprovided on every site/tofu step.
    const names = assignedEnvNames(
      'export AWS_ACCESS_KEY_ID="$$SEAWEEDFS_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$$SEAWEEDFS_SECRET_ACCESS_KEY"',
    );
    expect([...names].toSorted()).toEqual([
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ]);
  });

  test("records the assigned name, not the secret key it reads from", () => {
    const names = assignedEnvNames('export ARGOCD_TOKEN="$$ARGOCD_AUTH_TOKEN"');
    expect(names.has("ARGOCD_TOKEN")).toBe(true);
    expect(names.has("ARGOCD_AUTH_TOKEN")).toBe(false);
  });

  test("reads a bare assignment prefixing a command", () => {
    expect(
      assignedEnvNames("DATABASE_URL=file:/tmp/x.db bun run test").has(
        "DATABASE_URL",
      ),
    ).toBe(true);
  });

  test("ignores shell expansions of a name", () => {
    expect(assignedEnvNames('echo "$$GH_TOKEN"').size).toBe(0);
  });
});

describe("ciSecretItemId", () => {
  const declaration = `
  new OnePasswordItem(chart, "buildkite-agent-token", {
    spec: { itemPath: "vaults/vault-a/items/item-for-the-agent-token" },
  });
  new OnePasswordItem(chart, "buildkite-ci-secrets", {
    spec: { itemPath: "vaults/vault-a/items/item-for-the-ci-secret" },
  });`;

  test("reads the id of the CI secret's item, not a neighbouring one", () => {
    expect(ciSecretItemId(declaration)).toBe("item-for-the-ci-secret");
  });

  test("throws rather than guessing when the declaration moves", () => {
    // Silently falling back would validate the wrong item and report success.
    expect(() => ciSecretItemId("// no OnePasswordItem here")).toThrow(
      "no OnePasswordItem named",
    );
    expect(() =>
      ciSecretItemId('new OnePasswordItem(chart, "buildkite-ci-secrets", {});'),
    ).toThrow("declares no vaults");
  });
});

describe("commandScopes", () => {
  test("keeps a subshell export out of scripts that run outside it", () => {
    // pr-dryrun exports the AWS names inside `( … )` around its Tofu loop and
    // runs other scripts after it. Treating the command as one flat scope
    // reported those names as provided to every script in the step — a false
    // negative in the direction this check exists to prevent.
    const scopes = commandScopes(
      [
        "(",
        '  export AWS_ACCESS_KEY_ID="$$SEAWEEDFS_ACCESS_KEY_ID"',
        "  bun packages/homelab/scripts/tofu-stack.ts seaweedfs plan",
        ")",
        "bun scripts/deploy-site.ts wiki --dry-run",
      ].join("\n"),
    );
    const inside = scopes.find((scope) =>
      scope.scripts.includes("packages/homelab/scripts/tofu-stack.ts"),
    );
    const outside = scopes.find((scope) =>
      scope.scripts.includes("scripts/deploy-site.ts"),
    );
    expect(inside?.assigned.has("AWS_ACCESS_KEY_ID")).toBe(true);
    expect(outside?.assigned.has("AWS_ACCESS_KEY_ID")).toBe(false);
  });

  test("a command substitution is not treated as a subshell", () => {
    // `x=$(cmd)` opened a scope, recorded the assignment inside it, then
    // popped — losing the name from the scope that actually has it, and
    // splitting the step's invocations across scopes that do not exist.
    const scopes = commandScopes(
      [
        'export DIGEST="$$(bun scripts/release.ts resolve)"',
        "bun scripts/deploy-site.ts wiki",
      ].join("\n"),
    );
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.assigned.has("DIGEST")).toBe(true);
    expect(scopes[0]?.scripts).toContain("scripts/deploy-site.ts");
  });

  test("an export before a subshell is still visible inside it", () => {
    const scopes = commandScopes(
      ['export SHARED="x"', "(", "  bun scripts/release.ts", ")"].join("\n"),
    );
    const inner = scopes.find((scope) =>
      scope.scripts.includes("scripts/release.ts"),
    );
    expect(inner?.assigned.has("SHARED")).toBe(true);
  });
});

describe("structuralParens", () => {
  test("keeps subshell parens and drops substitution parens", () => {
    expect(structuralParens("( export A=1 )")).toBe("()");
    expect(structuralParens('X="$(cmd (nested))"')).toBe("");
    expect(structuralParens('( X="$$(cmd)" )')).toBe("()");
  });
});

describe("scriptPathsInCommand", () => {
  test("finds root, buildkite, and package script invocations", () => {
    const paths = scriptPathsInCommand(
      [
        "bun --no-install scripts/release.ts --dry-run",
        "bun --no-install .buildkite/scripts/ci-changed.ts images",
        "bun --no-install packages/homelab/scripts/argocd.ts release-root apps",
      ].join("\n"),
    );
    expect(paths).toEqual([
      ".buildkite/scripts/ci-changed.ts",
      "packages/homelab/scripts/argocd.ts",
      "scripts/release.ts",
    ]);
  });

  test("does not treat a turbo task name as a script path", () => {
    expect(scriptPathsInCommand("bun --no-install run verify")).toEqual([]);
  });
});

describe("collectSteps", () => {
  const pipeline = parse(
    `
env:
  TURBO_TEAM: monorepo
steps:
  - key: with-secret
    command: bun scripts/release.ts
    plugins:
      - kubernetes:
          podSpecPatch:
            containers:
              - name: container-0
                env:
                  - name: BUILDKITE_SHELL
                    value: /bin/bash -e -c
                envFrom:
                  - secretRef: { name: buildkite-ci-secrets }
  - key: no-secret
    command: bun scripts/publish-npm.ts
    plugins:
      - kubernetes:
          podSpecPatch:
            containers:
              - name: container-0
`,
    { merge: true },
  );

  test("does not count an env key explicitly set to an empty value", () => {
    // requireEnv rejects "" as missing, so an empty value satisfies nothing.
    // Counting it would pass the check on a step whose script fails at runtime.
    const withBlank = parse(
      `
steps:
  - key: blank-env
    command: bun scripts/release.ts
    env:
      SET_BUT_EMPTY: ""
      REAL: value
    plugins:
      - kubernetes:
          podSpecPatch:
            containers:
              - name: container-0
                env:
                  - name: CONTAINER_EMPTY
                    value: ""
                  - name: FROM_FIELD_REF
                    valueFrom: { fieldRef: { fieldPath: metadata.name } }
`,
      { merge: true },
    );
    const step = collectSteps(withBlank, [])[0];
    expect(step?.providedNames.has("REAL")).toBe(true);
    expect(step?.providedNames.has("SET_BUT_EMPTY")).toBe(false);
    expect(step?.providedNames.has("CONTAINER_EMPTY")).toBe(false);
    // An absent `value` means valueFrom, which does provide one.
    expect(step?.providedNames.has("FROM_FIELD_REF")).toBe(true);
  });

  test("records the CI secret, container env, and global env per step", () => {
    const steps = collectSteps(pipeline, ["TURBO_TEAM"]);
    const withSecret = steps.find((step) => step.key === "with-secret");
    expect(withSecret?.usesCiSecret).toBe(true);
    expect(withSecret?.providedNames.has("BUILDKITE_SHELL")).toBe(true);
    expect(withSecret?.providedNames.has("TURBO_TEAM")).toBe(true);
    expect(withSecret?.scripts).toEqual(["scripts/release.ts"]);
    expect(steps.find((step) => step.key === "no-secret")?.usesCiSecret).toBe(
      false,
    );
  });
});

describe("collectErrors", () => {
  const step = {
    key: "release-please",
    providedNames: new Set(["EXPORTED_NAME"]),
    usesCiSecret: true,
    scripts: ["scripts/release.ts"],
  };

  test("passes a name the secret carries", () => {
    const errors = collectErrors({
      steps: [step],
      secret: secretWith(["CLAUDE_CODE_OAUTH_TOKEN"]),
      requiredFor: () =>
        required({ CLAUDE_CODE_OAUTH_TOKEN: "scripts/release.ts:62" }),
    });
    expect(errors).toEqual([]);
  });

  test("passes a name the step's command assigns", () => {
    const errors = collectErrors({
      steps: [step],
      secret: secretWith([]),
      requiredFor: () => required({ EXPORTED_NAME: "scripts/release.ts:10" }),
    });
    expect(errors).toEqual([]);
  });

  test("reports a name nothing provides, naming step, script, and site", () => {
    const errors = collectErrors({
      steps: [step],
      secret: secretWith([]),
      requiredFor: () =>
        required({ CODEX_ACCESS_TOKEN: "scripts/release.ts:63" }),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("release-please");
    expect(errors[0]).toContain("scripts/release.ts");
    expect(errors[0]).toContain("CODEX_ACCESS_TOKEN");
    expect(errors[0]).toContain("scripts/release.ts:63");
  });

  test("reports a field the secret carries but leaves blank", () => {
    // The operator skips empty fields, so a blank field is as absent at
    // runtime as a missing one — and far more confusing.
    const errors = collectErrors({
      steps: [step],
      secret: secretWith(["NPM_TOKEN"], ["NPM_TOKEN"]),
      requiredFor: () => required({ NPM_TOKEN: "scripts/release.ts:20" }),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("BLANK");
  });

  test("ignores names the Buildkite agent injects", () => {
    const errors = collectErrors({
      steps: [step],
      secret: secretWith([]),
      requiredFor: () => required({ BUILDKITE_COMMIT: "scripts/release.ts:5" }),
    });
    expect(errors).toEqual([]);
  });

  test("reports a requireEnv whose argument is not a literal", () => {
    const errors = collectErrors({
      steps: [step],
      secret: secretWith([]),
      requiredFor: () => required({}, ["scripts/release.ts:220"]),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("not a string literal");
  });

  test("does not apply one script's exception names to another script", () => {
    // The declared names belong to the excepted call site alone. Leaking them
    // into every script would make unrelated steps require them, which is how
    // adding a name to one exception could redden steps that never run it.
    const exceptions = [
      {
        file: "scripts/deploy-site.ts",
        reason: "test",
        names: ["ONLY_FOR_DEPLOY_SITE"],
      },
    ];
    const releaseErrors = collectErrors({
      steps: [step],
      secret: secretWith([]),
      requiredFor: () => required({}),
      dynamicCallExceptions: exceptions,
    });
    expect(releaseErrors).toEqual([]);

    // …and the excepted script itself still has its declared names checked.
    const deployErrors = collectErrors({
      steps: [{ ...step, scripts: ["scripts/deploy-site.ts"] }],
      secret: secretWith([]),
      requiredFor: () => required({}),
      dynamicCallExceptions: exceptions,
    });
    expect(deployErrors).toHaveLength(1);
    expect(deployErrors[0]).toContain("ONLY_FOR_DEPLOY_SITE");
  });

  test("accepts a declared dynamic-call exception and still checks its names", () => {
    // scripts/deploy-site.ts is the declared exception; its unresolved call is
    // silent, but any name the exception declares is checked like any other.
    const deployStep = { ...step, scripts: ["scripts/deploy-site.ts"] };
    const errors = collectErrors({
      steps: [deployStep],
      secret: secretWith([]),
      requiredFor: () => required({}, ["scripts/deploy-site.ts:220"]),
    });
    expect(errors).toEqual([]);
  });
});
