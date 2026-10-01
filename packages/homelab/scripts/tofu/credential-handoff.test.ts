import { describe, expect, test } from "vitest";
import {
  assertPreparationAction,
  ApplicationSecretsSchema,
  applicationSecrets,
  jsonCredential,
} from "./application-secrets.ts";
import catalogSchema from "#tofu/application-secrets/desired-state.schema.json" with { type: "json" };
import {
  previewAdoption,
  targetValue,
  verifyHandoffs,
  main,
  handoffEnvironment,
} from "./credential-handoff.ts";
import { parsePrivateJson, capturedRead } from "./secret-read.ts";
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

describe("credential preparation", () => {
  test("failed private subprocess output stays out of errors", async () => {
    await expect(
      capturedRead(
        [
          "bun",
          "-e",
          'console.log("fixture-private-stdout"); console.error("fixture-private-stderr"); process.exit(1);',
        ],
        "synthetic failure",
      ),
    ).rejects.toThrow(
      "Read failed (synthetic failure); command output withheld.",
    );
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
    expect(stdout + stderr).toContain("only validate is enabled");
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

  test("section fields require exact selectors and long ASCII adoption preserves values", () => {
    const postal = {
      vault_item_id: "postal",
      vault_field: "RAILS_SECRET_KEY",
      vault_section_id: "section",
      vault_field_id: "field",
    };
    const value = "fixture-long-existing-key".repeat(5);
    const source = [
      {
        id: "postal",
        title: "postal",
        fields: [
          {
            id: "field",
            label: "RAILS_SECRET_KEY",
            section: { id: "section" },
            value,
          },
        ],
      },
    ];
    expect(
      targetValue(source, {
        vault_item_id: "postal",
        vault_field: "RAILS_SECRET_KEY",
      }),
    ).toBeUndefined();
    expect(targetValue(source, postal) === value).toBe(true);
    expect(
      targetValue(source, { ...postal, vault_field_id: "other" }),
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

  test("missing/ambiguous fields and unequal ChartMuseum values block adoption", () => {
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
    expect(unit?.status).toBe("blocked");
    expect(unit?.reasons).toContain(
      "targets contain different values; retain both and investigate identity",
    );
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
