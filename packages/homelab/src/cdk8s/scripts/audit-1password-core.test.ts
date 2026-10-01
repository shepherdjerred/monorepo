import { describe, expect, test } from "vitest";
import {
  buildVaultAudit,
  credentialLocations,
  manifestAuditReferences,
  sourceAuditReferences,
  pipelineGrantManifest,
} from "./audit-1password-core.ts";
import { VAULT_ID, type OpItem } from "./onepassword-lib.ts";

const privateValue = "fixture-sensitive-value-do-not-report";
const items: OpItem[] = [
  {
    id: "first",
    title: "service",
    version: 3,
    fields: [
      { id: "key", label: "API_KEY", type: "CONCEALED", value: privateValue },
    ],
  },
  {
    id: "second",
    title: "copy",
    fields: [
      {
        id: "config",
        label: "config",
        value: JSON.stringify({ api_key: privateValue, username: "same-user" }),
      },
    ],
  },
  {
    id: "empty",
    title: "unknown-service",
    fields: [{ id: "blank", label: "password", value: "" }],
  },
];
const binding = (namespace: string, item: string) => ({
  kind: "OnePasswordItem",
  metadata: { namespace, name: "auth" },
  spec: { itemPath: `vaults/${VAULT_ID}/items/${item}` },
});

describe("read-only vault audit", () => {
  test("CI grants join to the CI namespace and computed field grants protect the whole item", () => {
    const pipeline = pipelineGrantManifest(
      'grant("auth", "API_KEY"); grant("auth", STATE_PASSPHRASE_KEY); const g = { secret: "auth", key: "credential", env: "ENV" };',
      "pipeline",
    );
    const refs = manifestAuditReferences(
      [binding("woodpecker-ci", "first"), pipeline],
      "test",
    );
    expect(refs.references).toContainEqual({
      item: "first",
      field: "API_KEY",
      access: "operator",
      source: "test:woodpecker-ci/Pod/pipeline",
    });
    expect(refs.references).toContainEqual({
      item: "first",
      wholeItem: true,
      source: "test:woodpecker-ci/Pod/pipeline",
    });
    expect(refs.references).toContainEqual({
      item: "first",
      field: "credential",
      access: "operator",
      source: "test:woodpecker-ci/Pod/pipeline",
    });
  });
  test("compares credentials in memory without emitting values or fingerprints", () => {
    const audit = buildVaultAudit(
      items,
      [{ item: "service", field: "API_KEY", source: "test" }],
      { inspected: ["test"], gaps: ["external consumers"] },
    );
    expect(audit.duplicates[0]?.locations).toEqual([
      { item_id: "first", field_path: "key" },
      { item_id: "second", field_path: "config#/api_key" },
    ]);
    expect(JSON.stringify(audit)).not.toContain(privateValue);
    expect(JSON.stringify(audit)).not.toContain("same-user");
    expect(audit.archive_ready).toEqual([]);
    expect(audit.inventory[2]?.protection).toContain(
      "consumer coverage incomplete",
    );
  });

  test("identifiers, empty fields and configuration are excluded from equality", () => {
    expect(
      credentialLocations({
        id: "config",
        title: "config",
        fields: [
          {
            id: "id",
            label: "ACCESS_KEY_ID",
            type: "CONCEALED",
            value: "identifier",
          },
          { id: "username", label: "username", value: "user" },
          { id: "password", label: "password", value: "" },
          {
            id: "config",
            label: "config",
            value: '{"region":"x","client_id":"id"}',
          },
          {
            id: "agent",
            label: "PRIVATEHD_USER_AGENT",
            type: "CONCEALED",
            value: "config",
          },
          {
            id: "dsn",
            label: "SENTRY_DSN",
            type: "CONCEALED",
            value: "config",
          },
        ],
      }),
    ).toEqual([]);
  });
  test("declared JSON pointers and array credentials are included without comparing whole config blobs", () => {
    const item: OpItem = {
      id: "json",
      title: "config",
      fields: [
        {
          id: "config",
          label: "config",
          type: "CONCEALED",
          value: JSON.stringify({
            openai: privateValue,
            cloudflare: [{ authentication: { api_token: privateValue } }],
            region: "same",
          }),
        },
      ],
    };
    const locations = credentialLocations(item, [
      { item: "json", field: "config", jsonPath: "/openai", source: "desired" },
    ]);
    expect(locations.map((location) => location.path)).toEqual([
      "config#/cloudflare/0/authentication/api_token",
      "config#/openai",
    ]);
    expect(locations.every((location) => location.value === privateValue)).toBe(
      true,
    );
  });

  test("resolves namespaces and protects whole-secret, optional and opaque consumers", () => {
    const refs = manifestAuditReferences(
      [
        binding("app", "first"),
        binding("other", "second"),
        {
          kind: "Application",
          metadata: { namespace: "argocd", name: "app" },
          spec: {
            destination: { namespace: "app" },
            values: { existingSecret: "auth" },
          },
        },
        {
          kind: "Pod",
          metadata: { namespace: "other", name: "pod" },
          spec: {
            envFrom: [{ secretRef: { name: "auth" } }],
            volumes: [{ secret: { secretName: "auth" } }],
            env: [
              {
                valueFrom: {
                  secretKeyRef: { name: "auth", key: "config", optional: true },
                },
              },
            ],
          },
        },
        {
          kind: "Pod",
          metadata: { namespace: "unknown", name: "pod" },
          secretKeyRef: { name: "unknown", key: "password" },
        },
      ],
      "test",
    );
    expect(refs.references).toContainEqual({
      item: "first",
      source: "test:app/Application/app",
      wholeItem: true,
    });
    expect(refs.references).toContainEqual({
      item: "second",
      source: "test:other/Pod/pod",
      field: "config",
      access: "operator",
    });
    expect(refs.unresolved).toHaveLength(1);
  });

  test("ambiguous titles cannot authorize cleanup or silently select a target", () => {
    const audit = buildVaultAudit(
      [
        { ...items[0]!, title: "duplicate" },
        { ...items[1]!, title: "duplicate" },
      ],
      [{ item: "duplicate", source: "fixture" }],
      { inspected: [], gaps: [] },
    );
    expect(audit.unresolved).toEqual([
      "fixture: missing or ambiguous item duplicate",
    ]);
    expect(audit.archive_ready).toEqual([]);
  });

  test("dotfile reference scan emits paths only and respects vault scope", () => {
    const refs = sourceAuditReferences(
      `onepasswordRead "op://${VAULT_ID}/first/password"\nTOKEN=${privateValue}\nop://Other/item/password`,
      "dotfile",
    );
    expect(refs).toEqual([
      {
        item: "first",
        field: "password",
        source: "dotfile",
        access: "onepassword",
      },
    ]);
    expect(JSON.stringify(refs)).not.toContain(privateValue);
  });
});

describe("secret reference syntax", () => {
  test("quoted section references preserve spaces and metadata query selectors", () => {
    expect(
      sourceAuditReferences(
        `op read "op://Homelab/first/add more/field?attribute=id"`,
        "fixture",
      ),
    ).toEqual([
      {
        item: "first",
        field: "add more/field",
        source: "fixture",
        access: "onepassword",
      },
    ]);
  });
});
