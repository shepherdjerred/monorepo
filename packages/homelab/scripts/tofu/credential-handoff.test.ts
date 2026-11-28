import { describe, expect, test, vi } from "vitest";
import { chmod, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertPreparationAction,
  ApplicationSecretsSchema,
  CredentialTargetSchema,
  applicationSecrets,
  jsonCredential,
} from "./application-secrets.ts";
import catalogSchema from "#tofu/application-secrets/desired-state.schema.json" with { type: "json" };
import {
  previewAdoption,
  selectHandoffWrites,
  targetValue,
  verifyHandoffs,
  main,
  handoffEnvironment,
  handoffDesiredState,
  assertCleanHandoffSource,
  R2_S3_CREDENTIAL_FIELDS,
} from "./credential-handoff.ts";
import { collectOnePasswordTargets } from "#scripts/platform-desired-state.ts";
import {
  capturedRead,
  parsePrivateJson,
  updateJsonCredential,
} from "./secret-read.ts";
import { runSecretWriteCli, writeSecretTargets } from "./secret-write.ts";
import { VAULT_ID } from "#cdk8s/scripts/onepassword-lib.ts";
import { z } from "zod";

const target = {
  vault_item_id: "item",
  vault_field: "config",
  vault_json_path: "/credentials/api_key",
};
const items = [
  {
    id: "item",
    title: "item",
    fields: [
      {
        id: "config",
        label: "config",
        value: '{"credentials":{"api_key":"fixture-key"},"region":"preserve"}',
      },
    ],
  },
];

describe("generated Cloudflare handoffs", () => {
  test("omitted managed follows the declared OpenTofu true default", () => {
    const generated = { vault_item_id: "generated", vault_field: "API_TOKEN" };
    const desired = {
      cloudflare_api_tokens: {
        generated,
        existing: {
          managed: false,
          vault_item_id: "existing",
          vault_field: "API_TOKEN",
        },
      },
    };
    expect(handoffDesiredState(desired, "cloudflare-tokens")).toEqual({
      cloudflare_api_tokens: { generated: { managed: true, ...generated } },
    });
    expect(desired.cloudflare_api_tokens.generated).toEqual(generated);
  });

  test("generated Cloudflare handoffs do not require unmanaged token targets", () => {
    const generated = { vault_item_id: "generated", vault_field: "API_TOKEN" };
    const existing = { vault_item_id: "existing", vault_field: "API_TOKEN" };
    const desired = {
      cloudflare_api_tokens: {
        generated: { managed: true, ...generated },
        existing: { managed: false, ...existing },
      },
    };
    const targets = collectOnePasswordTargets(
      handoffDesiredState(desired, "cloudflare-tokens"),
    ).map((reference) => CredentialTargetSchema.parse(reference));
    const report = verifyHandoffs(
      { generated: { api_token: "fixture-token", ...generated } },
      targets,
      [
        {
          id: "generated",
          title: "generated",
          fields: [{ id: "token", label: "API_TOKEN", value: "fixture-token" }],
        },
      ],
    );
    expect(report).toHaveLength(1);
    expect(report[0]?.status).toBe("matches");
    expect(desired.cloudflare_api_tokens.existing).toEqual({
      managed: false,
      ...existing,
    });
  });
});

describe("R2 S3 credential handoffs", () => {
  const token = {
    vault_item_id: "wal",
    vault_field: "credential",
    s3_credential: true,
  };

  test("a token that opts in owns its derived S3 fields as separate units", () => {
    const desired = handoffDesiredState(
      {
        cloudflare_api_tokens: {
          wal: token,
          plain: { vault_item_id: "plain", vault_field: "credential" },
        },
      },
      "cloudflare-tokens",
    );
    expect(desired).toEqual({
      cloudflare_api_tokens: {
        wal: { managed: true, ...token },
        plain: {
          managed: true,
          vault_item_id: "plain",
          vault_field: "credential",
        },
        "wal.s3-access-key-id": {
          vault_item_id: "wal",
          vault_field: R2_S3_CREDENTIAL_FIELDS["s3-access-key-id"],
        },
        "wal.s3-secret-access-key": {
          vault_item_id: "wal",
          vault_field: R2_S3_CREDENTIAL_FIELDS["s3-secret-access-key"],
        },
      },
    });
  });

  test("the stack derives the units from the same fields", async () => {
    const configuration: unknown = await Bun.file(
      new URL("../../src/tofu/cloudflare-tokens/main.tf.json", import.meta.url),
    ).json();
    const { locals } = z
      .looseObject({
        locals: z.looseObject({ r2_s3_credential_fields: z.unknown() }),
      })
      .parse(configuration);
    expect(locals.r2_s3_credential_fields).toEqual(R2_S3_CREDENTIAL_FIELDS);
  });

  test("the committed registry publishes its managed tokens and the archive token's R2 keys", async () => {
    const desired: unknown = await Bun.file(
      new URL(
        "../../src/tofu/cloudflare-tokens/desired-state.json",
        import.meta.url,
      ),
    ).json();
    const { cloudflare_api_tokens: units } = z
      .looseObject({
        cloudflare_api_tokens: z.record(
          z.string(),
          z.looseObject({ vault_item_id: z.string(), vault_field: z.string() }),
        ),
      })
      .parse(handoffDesiredState(desired, "cloudflare-tokens"));
    expect(Object.keys(units).toSorted()).toEqual([
      "delivery-static-cache",
      "personal-archives-r2",
      "personal-archives-r2.s3-access-key-id",
      "personal-archives-r2.s3-secret-access-key",
      "woodpecker",
    ]);
    expect(units["personal-archives-r2.s3-access-key-id"]).toEqual({
      vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
      vault_field: "CLOUDFLARE_R2_ACCESS_KEY_ID",
    });
    expect(units["personal-archives-r2.s3-secret-access-key"]).toEqual({
      vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
      vault_field: "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    });
  });

  test("an unmanaged token publishes no derived S3 units", () => {
    expect(
      handoffDesiredState(
        { cloudflare_api_tokens: { wal: { ...token, managed: false } } },
        "cloudflare-tokens",
      ),
    ).toEqual({ cloudflare_api_tokens: {} });
  });

  test("verification requires the token and both derived fields", () => {
    const desired = handoffDesiredState(
      { cloudflare_api_tokens: { wal: token } },
      "cloudflare-tokens",
    );
    const targets = collectOnePasswordTargets(desired).map((reference) =>
      CredentialTargetSchema.parse(reference),
    );
    expect(targets).toHaveLength(3);
    const vault = [
      {
        id: "wal",
        title: "wal",
        fields: [
          { id: "credential", label: "credential", value: "fixture-token" },
          {
            id: "access",
            label: "CLOUDFLARE_R2_ACCESS_KEY_ID",
            value: "fixture-id",
          },
          {
            id: "secret",
            label: "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
            value: "fixture-digest",
          },
        ],
      },
    ];
    const handoff = {
      wal: {
        api_token: "fixture-token",
        vault_item_id: "wal",
        vault_field: "credential",
      },
      "wal.s3-access-key-id": {
        value: "fixture-id",
        vault_item_id: "wal",
        vault_field: "CLOUDFLARE_R2_ACCESS_KEY_ID",
      },
      "wal.s3-secret-access-key": {
        value: "fixture-digest",
        vault_item_id: "wal",
        vault_field: "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
      },
    };
    const owners = new Map(
      Object.entries(handoff).map(([unit, entry]) => [
        JSON.stringify([entry.vault_item_id, entry.vault_field, null]),
        unit,
      ]),
    );
    const report = verifyHandoffs(handoff, targets, vault, owners);
    expect(report.map(({ unit, status }) => [unit, status])).toEqual([
      ["wal", "matches"],
      ["wal.s3-access-key-id", "matches"],
      ["wal.s3-secret-access-key", "matches"],
    ]);
    const { ["wal.s3-secret-access-key"]: _omitted, ...partial } = handoff;
    expect(() => verifyHandoffs(partial, targets, vault, owners)).toThrow(
      /does not cover every declared target/u,
    );
  });
});

describe("label-only platform handoffs", () => {
  const platformTarget = {
    vault_item_id: "openai",
    vault_field: "OPENAI_API_KEY",
  };
  const sectioned = {
    id: "key",
    label: "OPENAI_API_KEY",
    section: { id: "credentials" },
    value: "fixture-platform-key",
  };

  test("a unique sectioned OpenAI field verifies without leaking its value", () => {
    const report = verifyHandoffs(
      {
        voice: {
          api_key: sectioned.value,
          onepassword_targets: [platformTarget],
        },
      },
      [platformTarget],
      [{ id: "openai", title: "openai", fields: [sectioned] }],
    );
    expect(report[0]?.status).toBe("matches");
    expect(JSON.stringify(report)).not.toContain(sectioned.value);
  });

  test("duplicate labels across sections are unresolved even for equal values", () => {
    const duplicate = { ...sectioned, id: "other", section: { id: "other" } };
    const report = verifyHandoffs(
      {
        voice: {
          api_key: sectioned.value,
          onepassword_targets: [platformTarget],
        },
      },
      [platformTarget],
      [{ id: "openai", title: "openai", fields: [sectioned, duplicate] }],
    );
    expect(report[0]?.status).toBe("unresolved");
    expect(JSON.stringify(report)).not.toContain(sectioned.value);
  });

  test("a top-level field shadowing a sectioned label is unresolved", () => {
    expect(
      targetValue(
        [
          {
            id: "openai",
            title: "openai",
            fields: [
              sectioned,
              { id: "top", label: sectioned.label, value: sectioned.value },
            ],
          },
        ],
        platformTarget,
      ),
    ).toBeUndefined();
  });
});

describe("credential preparation", () => {
  test.each([
    { file: "packages/homelab/src/delivery-platform-grants.ts" },
    { file: "packages/homelab/package.json" },
    { file: "packages/homelab/src/cdk8s/package.json" },
    { file: "packages/homelab/tsconfig.scripts.json" },
    { file: "tsconfig.base.json" },
    { file: "bunfig.toml" },
    { file: "bun.lock" },
    {
      file: "packages/homelab/src/tofu/application-secrets/terraform.tfvars",
      ignored: true,
    },
    {
      file: "packages/homelab/src/tofu/application-secrets/local.auto.tfvars.json",
      ignored: true,
    },
    {
      file: "packages/homelab/src/tofu/application-secrets/local_override.tf",
      ignored: true,
    },
    {
      file: "packages/homelab/src/tofu/application-secrets/local_override.tofu",
      ignored: true,
    },
    {
      file: "packages/homelab/src/tofu/application-secrets/credentials.tofu.json",
      ignored: true,
    },
  ])("handoff rejects uncommitted input: $file", async ({ file, ignored }) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "handoff-source-"));
    const read = async (command: string[]) => {
      const child = Bun.spawn(command, {
        cwd: fixture,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(0);
      return stdout;
    };
    try {
      await read(["git", "init", "--quiet"]);
      await assertCleanHandoffSource(read);
      if (ignored)
        await writeFile(path.join(fixture, ".gitignore"), "*.tf*\n*.tofu*\n");
      const fixturePath = path.join(fixture, file);
      await mkdir(path.dirname(fixturePath), { recursive: true });
      await writeFile(fixturePath, "synthetic module-resolution input\n");
      await expect(assertCleanHandoffSource(read)).rejects.toThrow(
        ignored
          ? "Uncommitted autoloaded"
          : "Verify requires clean owning source",
      );
      await read(["git", "add", "--force", "--", file]);
      await expect(assertCleanHandoffSource(read)).rejects.toThrow(
        "Verify requires clean owning source",
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
  test("failed private subprocess output stays out of errors while recording exit status", async () => {
    const promise = capturedRead(
      [
        "bun",
        "-e",
        'console.log("fixture-private-stdout"); console.error("fixture-private-stderr"); process.exit(1);',
      ],
      "synthetic failure",
    );
    await expect(promise).rejects.toThrow(
      "Read failed (synthetic failure, exit 1); command output withheld.",
    );
    await promise.catch((error: unknown) => {
      const rendered = String(error);
      expect(rendered).not.toContain("fixture-private-stdout");
      expect(rendered).not.toContain("fixture-private-stderr");
    });
    await expect(
      capturedRead(["/nonexistent-binary-fixture"], "missing binary"),
    ).rejects.toThrow("Read failed (missing binary); command output withheld.");
  });
  test("the new stack wrapper rejects live apply before requesting credentials", async () => {
    const child = Bun.spawn(
      [
        "bun",
        new URL("tofu-stack.ts", import.meta.url).pathname,
        "application-secrets",
        "apply",
      ],
      { env: { PATH: Bun.env["PATH"] }, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain(
      "general application-secret live actions are disabled",
    );
    expect(stdout + stderr).not.toContain("Missing credential");
  });
  test("committed language-neutral schema matches the runtime validator", () => {
    expect(z.toJSONSchema(ApplicationSecretsSchema)).toEqual(catalogSchema);
  });
  test("existing provider JSON pointers handle arrays and escaped object keys", () => {
    const value =
      '{"cloudflare":[{"authentication":{"api_token":"fixture"}}],"a/b":{"~key":"escaped"}}';
    expect(
      jsonCredential(value, "/cloudflare/0/authentication/api_token"),
    ).toBe("fixture");
    expect(jsonCredential(value, "/a~1b/~0key")).toBe("escaped");
    expect(
      jsonCredential(value, "/cloudflare/01/authentication/api_token"),
    ).toBeUndefined();
    expect(jsonCredential(value, "/a~2b")).toBeUndefined();
  });
});

describe("physical selector adoption", () => {
  test("section fields require exact selectors and long ASCII adoption preserves values", () => {
    const mailItem = {
      vault_item_id: "mail-secrets",
      vault_field: "MAIL_API_TOKEN",
      vault_section_id: "section",
      vault_field_id: "field",
    };
    const value = "fixture-long-existing-key".repeat(5);
    const source = [
      {
        id: "mail-secrets",
        title: "mail-secrets",
        fields: [
          {
            id: "field",
            label: "MAIL_API_TOKEN",
            section: { id: "section" },
            value,
          },
        ],
      },
    ];
    expect(
      targetValue(source, {
        vault_item_id: "mail-secrets",
        vault_field: "MAIL_API_TOKEN",
        vault_field_id: "field",
      }),
    ).toBeUndefined();
    expect(targetValue(source, mailItem) === value).toBe(true);
    expect(
      targetValue(source, { ...mailItem, vault_field_id: "other" }),
    ).toBeUndefined();
    expect(
      targetValue(source, { ...mailItem, vault_section_id: "other" }),
    ).toBeUndefined();
    const scout = previewAdoption([
      {
        id: "pacrc4wfbtct4y3qazkvazop5a",
        title: "scout",
        fields: [
          {
            id: "zmapbr6yh2pck73isbgokzff4q",
            label: "JWT_SIGNING_SECRET",
            value,
          },
        ],
      },
    ]).find((unit) => unit.key === "scout_production");
    expect(scout?.status).toBe("preserve-value-adoption-candidate");
    expect(JSON.stringify(scout)).not.toContain(value);
  });
  test("handoff output environment has only state bootstrap credentials", () => {
    const requested: string[] = [];
    const env = handoffEnvironment((name) => {
      requested.push(name);
      return "fixture";
    });
    expect(requested).toEqual([
      "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
      "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
      "TOFU_STATE_ENCRYPTION_PASSPHRASE",
    ]);
    expect(env["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
    expect(env["OPENAI_ADMIN_KEY"]).toBeUndefined();
  });

  test("provider null JSON paths normalize to plain fields and ownership is exact", () => {
    const plain = { vault_item_id: "item", vault_field: "config" };
    const handoff = {
      unit: {
        api_token: items[0]?.fields[0]?.value,
        ...plain,
        vault_json_path: null,
      },
    };
    expect(verifyHandoffs(handoff, [plain], items)[0]?.status).toBe("matches");
    const owners = new Map([
      [JSON.stringify(["item", "config", null]), "other-unit"],
    ]);
    expect(() => verifyHandoffs(handoff, [plain], items, owners)).toThrow(
      "does not own",
    );
  });
  test("all mutations reject before authentication or reading outputs", async () => {
    for (const action of ["write", "apply", "import", "archive", "delete"]) {
      expect(() => assertPreparationAction(action)).toThrow("disabled");
      await expect(main(["application-secrets", action])).rejects.toThrow(
        "disabled",
      );
    }
  });

  test("JSON leaf verification preserves configuration and never emits credential values", () => {
    expect(targetValue(items, target)).toBe("fixture-key");
    const report = verifyHandoffs(
      { unit: { api_key: "fixture-key", onepassword_targets: [target] } },
      [target],
      items,
    );
    expect(report[0]?.status).toBe("matches");
    expect(JSON.stringify(report)).not.toContain("fixture-key");
    expect(items[0]?.fields[0]?.value).toContain('"region":"preserve"');
  });

  test("undeclared, duplicate, missing or malformed ownership fails closed", () => {
    const handoff = { value: "fixture-key", onepassword_targets: [target] };
    expect(() =>
      verifyHandoffs({ first: handoff, second: handoff }, [target], items),
    ).toThrow("conflicting");
    expect(() => verifyHandoffs({ first: handoff }, [], items)).toThrow(
      "undeclared",
    );
    expect(() => verifyHandoffs({}, [target], items)).toThrow("every declared");
    expect(() =>
      verifyHandoffs({ unit: { value: "fixture-key" } }, [target], items),
    ).toThrow("missing");
    expect(() =>
      parsePrivateJson('{"private":"fixture-key"}', z.string()),
    ).toThrow("details withheld");
  });

  test("ambiguous targets fail and retired ChartMuseum copies do not define ownership", () => {
    expect(
      targetValue(
        [{ ...items[0]!, fields: [...items[0]!.fields, ...items[0]!.fields] }],
        target,
      ),
    ).toBeUndefined();
    const preview = previewAdoption([
      {
        id: "wwoism5fsvmbisv4ef47yxqy2i",
        title: "server",
        fields: [
          { id: "password", label: "password", value: "server-value" },
          { id: "username", label: "username", value: "user" },
        ],
      },
      {
        id: "cnutkdwa7uka5hk3wx5gimyfom",
        title: "ci",
        fields: [
          {
            id: "vw57xygo72zmxbflhyasorzfk4",
            label: "CHARTMUSEUM_PASSWORD",
            value: "ci-value",
          },
          { id: "username", label: "CHARTMUSEUM_USERNAME", value: "user" },
        ],
      },
    ]);
    const unit = preview.find((entry) => entry.key === "chartmuseum");
    expect(unit?.status).toBe("preserve-value-adoption-candidate");
    expect(unit?.targets.map((entry) => entry.vault_item_id)).toEqual([
      "wwoism5fsvmbisv4ef47yxqy2i",
    ]);
    expect(unit?.reasons).toEqual([]);
    expect(JSON.stringify(preview)).not.toContain("server-value");
  });
});

describe("canonical catalog ownership", () => {
  test("case variants of field and section IDs cannot create a second owner", () => {
    const credential = Object.values(applicationSecrets.credentials)[0]!;
    const catalogTarget = credential.onepassword_targets[0]!;
    expect(
      ApplicationSecretsSchema.safeParse({
        $schema: "./desired-state.schema.json",
        credentials: {
          first: {
            ...credential,
            onepassword_targets: [
              { ...catalogTarget, vault_section_id: "Section" },
            ],
          },
          second: {
            ...credential,
            onepassword_targets: [
              {
                ...catalogTarget,
                vault_section_id: "SECTION",
                vault_field_id: catalogTarget.vault_field_id.toUpperCase(),
              },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });
  test("JSON pointers retain case-sensitive and parent-child ownership", () => {
    const credential = Object.values(applicationSecrets.credentials)[0]!;
    const catalogTarget = credential.onepassword_targets[0]!;
    const catalog = (left: string, right: string) => ({
      $schema: "./desired-state.schema.json",
      credentials: {
        first: {
          ...credential,
          onepassword_targets: [{ ...catalogTarget, vault_json_path: left }],
        },
        second: {
          ...credential,
          onepassword_targets: [
            {
              ...catalogTarget,
              vault_field_id: catalogTarget.vault_field_id.toUpperCase(),
              vault_json_path: right,
            },
          ],
        },
      },
    });
    expect(
      ApplicationSecretsSchema.safeParse(catalog("/token", "/TOKEN")).success,
    ).toBe(true);
    expect(
      ApplicationSecretsSchema.safeParse(catalog("/parent", "/parent/token"))
        .success,
    ).toBe(false);
  });
  test("catalog prevents two rotation units owning the same target", () => {
    const credential = Object.values(applicationSecrets.credentials)[0]!;
    expect(
      ApplicationSecretsSchema.safeParse({
        $schema: "./desired-state.schema.json",
        credentials: { first: credential, second: credential },
      }).success,
    ).toBe(false);
  });
  test("ownership follows IDs regardless of labels, property order or JSON parent selectors", () => {
    const credential = Object.values(applicationSecrets.credentials)[0]!;
    const original = credential.onepassword_targets[0]!;
    const aliased = {
      vault_field_id: original.vault_field_id,
      vault_field: "renamed-label",
      vault_item_id: original.vault_item_id,
    };
    const result = ApplicationSecretsSchema.safeParse({
      $schema: "./desired-state.schema.json",
      credentials: {
        first: credential,
        second: {
          ...credential,
          onepassword_targets: [
            { ...aliased, vault_json_path: "/nested/token" },
          ],
        },
      },
    });
    expect(result.success).toBe(false);
    expect(
      ApplicationSecretsSchema.safeParse({
        $schema: "./desired-state.schema.json",
        credentials: {
          first: {
            ...credential,
            onepassword_targets: [
              { vault_item_id: "title", vault_field: "TOKEN" },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });
});

async function createMockOpHarness(options?: {
  ignoreTemplateOnEdit?: boolean;
  failEditWithPrivateStderr?: boolean;
}) {
  const fixture = await mkdtemp(path.join(tmpdir(), "mock-op-handoff-"));
  const binDir = path.join(fixture, "bin");
  const homeDir = path.join(fixture, "home");
  const statePath = path.join(fixture, "vault.json");
  const callsPath = path.join(fixture, "calls.jsonl");
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  await Bun.write(
    statePath,
    JSON.stringify({
      items: {
        du6dxzjfiml7f7qnj2peyff3ba: {
          id: "du6dxzjfiml7f7qnj2peyff3ba",
          title: "personal-archives-r2",
          vault: { id: VAULT_ID },
          version: 4,
          category: "API_CREDENTIAL",
          tags: ["managed"],
          fields: [
            { id: "tok", label: "CLOUDFLARE_API_TOKEN", value: "old-r2-token" },
            {
              id: "ak",
              label: "CLOUDFLARE_R2_ACCESS_KEY_ID",
              value: "old-r2-id",
            },
            {
              id: "sk",
              label: "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
              value: "old-r2-digest",
            },
            {
              id: "cfg",
              label: "CONFIG_JSON",
              value: '{"nested":{"token":"old-json"},"keep":"preserved"}',
            },
          ],
        },
        djl2blalora2unjogqnsadlokq: {
          id: "djl2blalora2unjogqnsadlokq",
          title: "woodpecker-cloudflare",
          vault: { id: VAULT_ID },
          version: 2,
          fields: [
            {
              id: "cf",
              label: "CLOUDFLARE_API_TOKEN",
              value: "old-woodpecker-token",
            },
          ],
        },
      },
    }),
  );

  const mockOp = path.join(binDir, "op");
  await Bun.write(
    mockOp,
    String.raw`#!${process.execPath}
import { appendFileSync, fstatSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const stateFile = ${JSON.stringify(statePath)};
const callsFile = ${JSON.stringify(callsPath)};
const ignoreTemplate = ${JSON.stringify(options?.ignoreTemplateOnEdit === true)};
const failEdit = ${JSON.stringify(options?.failEditWithPrivateStderr === true)};

const state = JSON.parse(readFileSync(stateFile, "utf8"));

if (args[0] === "item" && args[1] === "get") {
  const id = args[2];
  appendFileSync(callsFile, JSON.stringify({ cmd: "get", args }) + "\n");
  const found = state.items[id];
  if (!found) {
    process.stderr.write("missing item\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(found));
  process.exit(0);
}

if (args[0] === "--cache=false" && args[1] === "item" && args[2] === "get") {
  const id = args[3];
  appendFileSync(callsFile, JSON.stringify({ cmd: "get-nocache", args }) + "\n");
  const found = state.items[id];
  if (!found) {
    process.stderr.write("missing item\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(found));
  process.exit(0);
}

if (args[0] === "--cache=false" && args[1] === "item" && args[2] === "edit") {
  const id = args[3];
  const templateIdx = args.indexOf("--template");
  const templateArg = templateIdx >= 0 ? args[templateIdx + 1] : null;
  const dryRun = args.includes("--dry-run");
  if (templateArg !== "/dev/fd/3") {
    process.stderr.write("expected --template /dev/fd/3\n");
    process.exit(2);
  }
  // Verify stdin (fd 0) is ignored (/dev/null), NOT a socket/pipe that triggers op's stdin check!
  const fd0Stat = fstatSync(0);
  if (fd0Stat.isSocket() || fd0Stat.isFIFO()) {
    process.stderr.write("fd 0 must be ignored when --template /dev/fd/3 is used\n");
    process.exit(3);
  }
  const fd3Stat = fstatSync(3);
  if (!fd3Stat.isFIFO() || fd3Stat.isSocket()) {
    process.stderr.write("fd 3 must be a POSIX FIFO so Linux /dev/fd/3 reopen succeeds\n");
    process.exit(4);
  }
  const rawTemplate = readFileSync("/dev/fd/3", "utf8");
  appendFileSync(
    callsFile,
    JSON.stringify({
      cmd: "edit",
      args,
      dryRun,
      stdinIgnored: !fd0Stat.isSocket() && !fd0Stat.isFIFO(),
    }) + "\n",
  );
  if (failEdit) {
    process.stderr.write("op error containing sensitive-probe-stderr-value\n");
    process.exit(1);
  }
  const parsed = JSON.parse(rawTemplate);
  if (!dryRun && !ignoreTemplate) {
    state.items[id] = { ...parsed, version: (state.items[id]?.version ?? 0) + 1 };
    writeFileSync(stateFile, JSON.stringify(state));
  }
  process.stdout.write(JSON.stringify(parsed));
  process.exit(0);
}

process.stderr.write("unexpected op args: " + JSON.stringify(args) + "\n");
process.exit(1);
`,
  );
  await chmod(mockOp, 0o755);

  const env = {
    ...Bun.env,
    HOME: homeDir,
    PATH: `${binDir}:${Bun.env["PATH"] ?? ""}`,
    OP_SERVICE_ACCOUNT_TOKEN: "fixture-sa-token",
  };

  return {
    fixture,
    binDir,
    homeDir,
    statePath,
    callsPath,
    env,
    async readCalls() {
      if (!(await Bun.file(callsPath).exists())) return [];
      const text = await Bun.file(callsPath).text();
      return text
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) =>
          z
            .object({
              cmd: z.string(),
              args: z.array(z.string()),
              dryRun: z.boolean().optional(),
              stdinIgnored: z.boolean().optional(),
            })
            .parse(JSON.parse(line)),
        );
    },
    async readStoredItem(id: string) {
      const parsed = z
        .object({ items: z.record(z.string(), z.unknown()) })
        .parse(await Bun.file(statePath).json());
      return parsed.items[id];
    },
    async cleanup() {
      await rm(fixture, { recursive: true, force: true });
    },
  };
}

describe("non-printing 1Password template writes (AI-93)", () => {
  test("updates plain and JSON-pointer fields over /dev/fd/3 with independent readback and preserves sibling metadata", async () => {
    const harness = await createMockOpHarness();
    const secretA = "replacement-r2-secret-value";
    const secretJson = "replacement-nested-json-secret";
    try {
      vi.stubEnv("HOME", harness.homeDir);
      vi.stubEnv("PATH", harness.env.PATH);
      vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "fixture-sa-token");

      const results = await writeSecretTargets(
        [
          {
            unit: "personal-archives-r2",
            target: {
              vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
              vault_field: "CLOUDFLARE_API_TOKEN",
            },
            value: secretA,
          },
          {
            unit: "json-unit",
            target: {
              vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
              vault_field: "CONFIG_JSON",
              vault_json_path: "/nested/token",
            },
            value: secretJson,
          },
        ],
        { env: harness.env },
      );

      expect(results).toEqual([
        {
          unit: "personal-archives-r2",
          target: {
            vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
            vault_field: "CLOUDFLARE_API_TOKEN",
          },
          resolved_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
          dry_run: false,
          changed: true,
          verified_readback: true,
        },
        {
          unit: "json-unit",
          target: {
            vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
            vault_field: "CONFIG_JSON",
            vault_json_path: "/nested/token",
          },
          resolved_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
          dry_run: false,
          changed: true,
          verified_readback: true,
        },
      ]);
      expect(JSON.stringify(results)).not.toContain(secretA);
      expect(JSON.stringify(results)).not.toContain(secretJson);

      const calls = await harness.readCalls();
      const editCall = calls.find((call) => call.cmd === "edit");
      expect(editCall).toBeDefined();
      expect(editCall?.stdinIgnored).toBe(true);
      expect(editCall?.dryRun).toBe(false);
      expect(editCall?.args).toEqual([
        "--cache=false",
        "item",
        "edit",
        "du6dxzjfiml7f7qnj2peyff3ba",
        "--vault",
        VAULT_ID,
        "--template",
        "/dev/fd/3",
        "--format",
        "json",
      ]);
      expect(calls.at(-1)?.cmd).toBe("get");

      const stored = z
        .object({
          tags: z.array(z.string()),
          category: z.string(),
          fields: z.array(z.object({ label: z.string(), value: z.string() })),
        })
        .parse(await harness.readStoredItem("du6dxzjfiml7f7qnj2peyff3ba"));
      expect(stored.tags).toEqual(["managed"]);
      expect(stored.category).toBe("API_CREDENTIAL");
      expect(
        stored.fields.find((field) => field.label === "CONFIG_JSON")?.value,
      ).toBe(`{"nested":{"token":"${secretJson}"},"keep":"preserved"}`);
    } finally {
      vi.unstubAllEnvs();
      await harness.cleanup();
    }
  });

  test("supports --dry-run preview via op item edit --dry-run without mutating vault state", async () => {
    const harness = await createMockOpHarness();
    const probeValue = "dry-run-replacement-value";
    try {
      vi.stubEnv("HOME", harness.homeDir);
      vi.stubEnv("PATH", harness.env.PATH);
      vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "fixture-sa-token");

      const results = await runSecretWriteCli(
        [
          "--item",
          "djl2blalora2unjogqnsadlokq",
          "--field",
          "CLOUDFLARE_API_TOKEN",
          "--dry-run",
        ],
        {
          env: harness.env,
          readSecret: async () => probeValue,
        },
      );

      expect(results).toEqual([
        {
          unit: null,
          target: {
            vault_item_id: "djl2blalora2unjogqnsadlokq",
            vault_field: "CLOUDFLARE_API_TOKEN",
          },
          resolved_item_id: "djl2blalora2unjogqnsadlokq",
          dry_run: true,
          changed: true,
          verified_readback: false,
        },
      ]);
      expect(JSON.stringify(results)).not.toContain(probeValue);

      const calls = await harness.readCalls();
      const editCall = calls.find((call) => call.cmd === "edit");
      expect(editCall?.dryRun).toBe(true);
      expect(editCall?.args).toContain("--dry-run");

      const stored = z
        .object({
          fields: z.array(z.object({ label: z.string(), value: z.string() })),
        })
        .parse(await harness.readStoredItem("djl2blalora2unjogqnsadlokq"));
      expect(stored.fields[0]?.value).toBe("old-woodpecker-token");
    } finally {
      vi.unstubAllEnvs();
      await harness.cleanup();
    }
  });
});

describe("non-printing 1Password readback & error hygiene (AI-93)", () => {
  test("catches silent template ignore via independent readVaultItem readback and withholds raw op stderr", async () => {
    const staleHarness = await createMockOpHarness({
      ignoreTemplateOnEdit: true,
    });
    try {
      vi.stubEnv("HOME", staleHarness.homeDir);
      vi.stubEnv("PATH", staleHarness.env.PATH);
      vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "fixture-sa-token");

      await expect(
        writeSecretTargets(
          [
            {
              unit: "woodpecker",
              target: {
                vault_item_id: "djl2blalora2unjogqnsadlokq",
                vault_field: "CLOUDFLARE_API_TOKEN",
              },
              value: "probe-ignored-secret",
            },
          ],
          { env: staleHarness.env },
        ),
      ).rejects.toThrow(
        "Independent 1Password readback did not match intended credential update.",
      );
    } finally {
      vi.unstubAllEnvs();
      await staleHarness.cleanup();
    }

    const failingHarness = await createMockOpHarness({
      failEditWithPrivateStderr: true,
    });
    try {
      vi.stubEnv("HOME", failingHarness.homeDir);
      vi.stubEnv("PATH", failingHarness.env.PATH);
      vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "fixture-sa-token");

      let caughtMessage = "";
      try {
        await writeSecretTargets(
          [
            {
              unit: "woodpecker",
              target: {
                vault_item_id: "djl2blalora2unjogqnsadlokq",
                vault_field: "CLOUDFLARE_API_TOKEN",
              },
              value: "probe-failing-secret",
            },
          ],
          { env: failingHarness.env },
        );
      } catch (error) {
        caughtMessage = error instanceof Error ? error.message : String(error);
      }
      expect(caughtMessage).toBe(
        "1Password template update failed; no credential values were logged.",
      );
      expect(caughtMessage).not.toContain("sensitive-probe-stderr-value");
      expect(caughtMessage).not.toContain("probe-failing-secret");
    } finally {
      vi.unstubAllEnvs();
      await failingHarness.cleanup();
    }
  });
});

describe("credential-handoff apply/write CLI (AI-93)", () => {
  test("selectHandoffWrites validates declared units and rejects unknown --unit names", async () => {
    const desired = handoffDesiredState(
      {
        cloudflare_api_tokens: {
          woodpecker: {
            vault_item_id: "djl2blalora2unjogqnsadlokq",
            vault_field: "CLOUDFLARE_API_TOKEN",
          },
          "delivery-static-cache": {
            vault_item_id: "la7gkfl5eqtxiiv2hq3qujx2gi",
            vault_field: "credential",
          },
        },
      },
      "cloudflare-tokens",
    );
    const targets = collectOnePasswordTargets(desired).map((reference) =>
      CredentialTargetSchema.parse(reference),
    );
    const owners = new Map([
      [
        JSON.stringify([
          "djl2blalora2unjogqnsadlokq",
          "CLOUDFLARE_API_TOKEN",
          null,
        ]),
        "woodpecker",
      ],
      [
        JSON.stringify(["la7gkfl5eqtxiiv2hq3qujx2gi", "credential", null]),
        "delivery-static-cache",
      ],
    ]);
    const handoffPayload = {
      woodpecker: {
        api_token: "cf-new-woodpecker",
        vault_item_id: "djl2blalora2unjogqnsadlokq",
        vault_field: "CLOUDFLARE_API_TOKEN",
      },
      "delivery-static-cache": {
        api_token: "cf-new-cache",
        vault_item_id: "la7gkfl5eqtxiiv2hq3qujx2gi",
        vault_field: "credential",
      },
    };

    expect(
      selectHandoffWrites(handoffPayload, targets, owners, ["woodpecker"]),
    ).toEqual([
      {
        unit: "woodpecker",
        target: {
          vault_item_id: "djl2blalora2unjogqnsadlokq",
          vault_field: "CLOUDFLARE_API_TOKEN",
        },
        value: "cf-new-woodpecker",
      },
    ]);
    expect(() =>
      selectHandoffWrites(handoffPayload, targets, owners, ["nonexistent"]),
    ).toThrow("Unknown handoff unit: nonexistent");
    expect(
      updateJsonCredential('{"a":{"b":"old"},"keep":1}', "/a/b", "new"),
    ).toEqual({
      updated: '{"a":{"b":"new"},"keep":1}',
      changed: true,
    });
    vi.stubEnv("CI", "true");
    try {
      await expect(main(["openai", "apply", "not-a-sha"])).rejects.toThrow(
        "Credential handoff writes are operator-only.",
      );
      vi.stubEnv("CI", "");
      await expect(main(["openai", "import"])).rejects.toThrow("disabled");
      await expect(main(["openai", "apply", "not-a-sha"])).rejects.toThrow(
        "Apply requires the current expected source revision",
      );
      await expect(main(["openai", "preview", "--dry-run"])).rejects.toThrow(
        "--unit and --dry-run are supported only with apply or write",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("credential-handoff apply/write end-to-end (AI-93)", () => {
  test("credential-handoff apply/write enforces clean-source guards and writes selected units end-to-end", async () => {
    const harness = await createMockOpHarness();
    const fakeHead = "a".repeat(40);
    const mockGit = path.join(harness.binDir, "git");
    const mockTofu = path.join(harness.binDir, "tofu");
    const dirtyFlag = path.join(harness.fixture, "dirty");
    try {
      await Bun.write(
        mockGit,
        String.raw`#!${process.execPath}
import { existsSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "rev-parse") {
  process.stdout.write(${JSON.stringify(`${fakeHead}\n`)});
  process.exit(0);
}
if (args[0] === "status") {
  if (existsSync(${JSON.stringify(dirtyFlag)})) {
    process.stdout.write(" M packages/homelab/scripts/tofu/credential-handoff.ts\n");
  }
  process.exit(0);
}
if (args[0] === "ls-files") {
  process.exit(0);
}
process.exit(1);
`,
      );
      await chmod(mockGit, 0o755);

      await Bun.write(
        mockTofu,
        `#!${process.execPath}
process.stdout.write(JSON.stringify({
  "delivery-static-cache": {
    api_token: "unused-cache-token",
    vault_item_id: "la7gkfl5eqtxiiv2hq3qujx2gi",
    vault_field: "credential"
  },
  "personal-archives-r2": {
    api_token: "unused-r2-token",
    vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
    vault_field: "CLOUDFLARE_API_TOKEN"
  },
  "personal-archives-r2.s3-access-key-id": {
    value: "unused-r2-id",
    vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
    vault_field: "CLOUDFLARE_R2_ACCESS_KEY_ID"
  },
  "personal-archives-r2.s3-secret-access-key": {
    value: "unused-r2-secret",
    vault_item_id: "du6dxzjfiml7f7qnj2peyff3ba",
    vault_field: "CLOUDFLARE_R2_SECRET_ACCESS_KEY"
  },
  woodpecker: {
    api_token: "rotated-woodpecker-token-secret",
    vault_item_id: "djl2blalora2unjogqnsadlokq",
    vault_field: "CLOUDFLARE_API_TOKEN"
  }
}));
`,
      );
      await chmod(mockTofu, 0o755);

      vi.stubEnv("HOME", harness.homeDir);
      vi.stubEnv("PATH", harness.env.PATH);
      vi.stubEnv("CI", "");
      vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "fixture-sa-token");
      vi.stubEnv("SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID", "fixture-state-id");
      vi.stubEnv("SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY", "fixture-state-key");
      vi.stubEnv("TOFU_STATE_ENCRYPTION_PASSPHRASE", "fixture-passphrase");

      await Bun.write(dirtyFlag, "dirty");
      await expect(
        main(["cloudflare-tokens", "write", fakeHead, "--unit", "woodpecker"]),
      ).rejects.toThrow("Verify requires clean owning source");
      await rm(dirtyFlag);
      expect(await harness.readCalls()).toEqual([]);

      const logged: string[] = [];
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation((...messages: unknown[]) => {
          logged.push(messages.map(String).join(" "));
        });
      try {
        await main([
          "cloudflare-tokens",
          "apply",
          fakeHead,
          "--unit",
          "woodpecker",
        ]);
      } finally {
        logSpy.mockRestore();
      }

      const outputJson = logged.join("\n");
      expect(outputJson).not.toContain("rotated-woodpecker-token-secret");
      const parsedReport = z
        .object({
          source_revision: z.string(),
          action: z.literal("apply"),
          dry_run: z.literal(false),
          selected_units: z.array(z.string()),
          results: z.array(
            z.object({
              unit: z.string(),
              verified_readback: z.boolean(),
            }),
          ),
        })
        .parse(JSON.parse(outputJson));
      expect(parsedReport.source_revision).toBe(fakeHead);
      expect(parsedReport.selected_units).toEqual(["woodpecker"]);
      expect(parsedReport.results).toEqual([
        expect.objectContaining({
          unit: "woodpecker",
          verified_readback: true,
        }),
      ]);
    } finally {
      vi.unstubAllEnvs();
      await harness.cleanup();
    }
  });
});
