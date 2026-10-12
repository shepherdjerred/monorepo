import { describe, expect, test } from "vitest";
import { buildFieldMapping } from "./field-map.ts";
import {
  VAULT_ID,
  type OpItem,
} from "homelab/src/cdk8s/scripts/onepassword-lib.ts";

const privateValue = "fixture-never-serialize-this";
const items: OpItem[] = [
  {
    id: "service-id",
    title: "service",
    fields: [
      { id: "key-id", label: "API KEY", value: privateValue },
      { id: "blank", label: "notesPlain", value: "" },
      { id: "username", label: "username", value: "fixture-username" },
      {
        id: "section-key",
        label: "API KEY",
        section: { id: "add more", label: "Extra" },
        value: privateValue,
      },
    ],
    urls: [{ label: "website", href: "fixture-private-url" }],
    files: [{ id: "file-id", name: "credentials.json" }],
  },
];

describe("canonical vault field mapping", () => {
  test("includes every physical field and supplemental metadata without values", () => {
    const mapping = buildFieldMapping(items, [
      { item: "service-id", source: "whole", wholeItem: true },
    ]);
    expect(mapping.summary.fields).toBe(4);
    expect(mapping.summary.fields_with_unique_reference).toBe(4);
    expect(mapping.summary.supplemental_entries).toBe(2);
    expect(mapping.fields[1]?.blank).toBe(true);
    expect(
      mapping.fields.every((entry) =>
        entry.whole_item_consumers.includes("whole"),
      ),
    ).toBe(true);
    const serialized = JSON.stringify(mapping);
    for (const value of [
      privateValue,
      "fixture-username",
      "fixture-private-url",
    ])
      expect(serialized).not.toContain(value);
    expect(mapping.fields[3]?.canonical_reference).toBe(
      `op://${VAULT_ID}/service-id/add more/section-key`,
    );
  });

  test("title, ID, label and section aliases converge; operator collisions remain unresolved", () => {
    const mapping = buildFieldMapping(items, [
      {
        item: "service",
        field: "Extra/API KEY",
        access: "onepassword",
        source: "label",
      },
      {
        item: "service-id",
        field: "add more/section-key",
        access: "onepassword",
        source: "id",
      },
      {
        item: "service-id",
        field: "API KEY",
        fieldId: "section-key",
        sectionId: "add more",
        source: "target",
      },
      { item: "service", field: "API-KEY", access: "operator", source: "pod" },
    ]);
    expect(
      new Set(
        mapping.reference_mappings
          .slice(0, 3)
          .map((entry) => entry.canonical_reference),
      ).size,
    ).toBe(1);
    expect(
      mapping.reference_mappings
        .slice(0, 3)
        .every((entry) => entry.status === "resolved"),
    ).toBe(true);
    expect(mapping.reference_mappings[3]?.status).toBe(
      "missing-or-ambiguous-field",
    );
    expect(mapping.collisions).toHaveLength(1);
  });

  test("Kubernetes keys cannot silently resolve as field IDs", () => {
    const mapping = buildFieldMapping(
      [
        {
          id: "item",
          title: "item",
          fields: [
            { id: "TOKEN", label: "different-label", value: privateValue },
          ],
        },
      ],
      [{ item: "item", field: "TOKEN", access: "operator", source: "pod" }],
    );
    expect(mapping.reference_mappings[0]?.status).toBe(
      "missing-or-ambiguous-field",
    );
  });

  test("duplicate IDs and case-insensitive collisions have no canonical reference", () => {
    const mapping = buildFieldMapping(
      [
        {
          id: "item",
          title: "item",
          fields: [
            { id: "username", label: "username", value: privateValue },
            { id: "USERNAME", label: "username", value: privateValue },
          ],
        },
      ],
      [],
    );
    expect(mapping.summary.ambiguous_fields).toBe(2);
    expect(
      mapping.fields.every((entry) => entry.canonical_reference === null),
    ).toBe(true);
    expect(mapping.fields.map((entry) => entry.locator.index)).toEqual([0, 1]);
  });

  test("equal values in different fields and environments keep different references", () => {
    const mapping = buildFieldMapping(
      [
        {
          id: "prod",
          title: "prod",
          fields: [{ id: "key", label: "TOKEN", value: privateValue }],
        },
        {
          id: "beta",
          title: "beta",
          fields: [{ id: "key", label: "TOKEN", value: privateValue }],
        },
      ],
      [],
    );
    expect(
      new Set(mapping.fields.map((entry) => entry.canonical_reference)).size,
    ).toBe(2);
  });

  test("URL and file operator selectors are resolved without reading their contents", () => {
    const mapping = buildFieldMapping(items, [
      { item: "service", field: "website", access: "operator", source: "pod" },
      {
        item: "service",
        field: "credentials.json",
        access: "operator",
        source: "pod",
      },
    ]);
    expect(
      mapping.reference_mappings.map((entry) => entry.locator?.kind),
    ).toEqual(["url", "file"]);
    expect(
      mapping.reference_mappings.every((entry) => entry.status === "resolved"),
    ).toBe(true);
  });

  test("JSON leaf selectors share a parent reference without losing their pointers", () => {
    const jsonItems = [
      {
        id: "service-id",
        title: "service",
        fields: [
          {
            id: "key-id",
            label: "config",
            value: '{"a/b":{"~key":"fixture-private-json"}}',
          },
        ],
      },
    ];
    const mapping = buildFieldMapping(jsonItems, [
      {
        item: "service",
        field: "key-id",
        jsonPath: "/a~1b/~0key",
        source: "json",
      },
      { item: "service", field: "key-id", jsonPath: "/absent", source: "json" },
    ]);
    expect(mapping.reference_mappings[0]?.json_path).toBe("/a~1b/~0key");
    expect(mapping.reference_mappings[0]?.canonical_reference).toBe(
      `op://${VAULT_ID}/service-id/key-id`,
    );
    expect(mapping.reference_mappings[0]?.status).toBe("resolved");
    expect(mapping.reference_mappings[1]?.status).toBe("missing-json-leaf");
    expect(JSON.stringify(mapping)).not.toContain("fixture-private-json");
  });
});

describe("canonical selector ambiguity", () => {
  test("an explicit top-level target rejects a field moved into a section", () => {
    const mapping = buildFieldMapping(items, [
      {
        item: "service-id",
        field: "API KEY",
        fieldId: "key-id",
        source: "top-level-target",
      },
      {
        item: "service-id",
        field: "API KEY",
        fieldId: "section-key",
        source: "moved-target",
      },
      {
        item: "service-id",
        field: "API KEY",
        fieldId: "section-key",
        sectionId: "add more",
        source: "section-target",
      },
      {
        item: "service-id",
        field: "section-key",
        access: "onepassword",
        source: "cli-selector",
      },
    ]);
    expect(mapping.reference_mappings.map((entry) => entry.status)).toEqual([
      "resolved",
      "missing-or-ambiguous-field",
      "resolved",
      "resolved",
    ]);
    expect(mapping.reference_mappings[1]?.candidates).toEqual([]);
    expect(mapping.summary.unresolved_references).toBe(1);
    expect(mapping.fields[3]?.consumers.map((entry) => entry.source)).toEqual([
      "section-target",
      "cli-selector",
    ]);
    expect(JSON.stringify(mapping)).not.toContain(privateValue);
  });

  test("a field ID shadowed by another label cannot claim a canonical reference", () => {
    const mapping = buildFieldMapping(
      [
        {
          id: "item",
          title: "item",
          fields: [
            { id: "first", label: "TOKEN", value: privateValue },
            { id: "second", label: "FIRST", value: privateValue },
          ],
        },
      ],
      [
        {
          item: "item",
          field: "first",
          access: "onepassword",
          source: "fixture",
        },
      ],
    );
    expect(mapping.fields[0]?.canonical_reference).toBeNull();
    expect(mapping.fields[0]?.status).toBe("ambiguous-identifier");
    expect(mapping.fields[1]?.canonical_reference).toBe(
      `op://${VAULT_ID}/item/second`,
    );
    expect(mapping.summary.fields_with_unique_reference).toBe(1);
    expect(mapping.collisions[0]?.kind).toBe("selector_alias");
    expect(
      mapping.collisions[0]?.locations.map((location) => location.index),
    ).toEqual([0, 1]);
    expect(mapping.reference_mappings[0]?.status).toBe(
      "missing-or-ambiguous-field",
    );
    expect(JSON.stringify(mapping)).not.toContain(privateValue);
  });

  test("same field IDs remain valid in distinct sections", () => {
    const mapping = buildFieldMapping(
      [
        {
          id: "item",
          title: "item",
          fields: [
            {
              id: "key",
              label: "TOKEN",
              section: { id: "prod" },
              value: privateValue,
            },
            {
              id: "key",
              label: "TOKEN",
              section: { id: "beta" },
              value: privateValue,
            },
          ],
        },
      ],
      [
        {
          item: "item",
          field: "prod/key",
          access: "onepassword",
          source: "prod",
        },
        {
          item: "item",
          field: "beta/key",
          access: "onepassword",
          source: "beta",
        },
      ],
    );
    expect(mapping.summary.fields_with_unique_reference).toBe(2);
    expect(
      mapping.reference_mappings.every((entry) => entry.status === "resolved"),
    ).toBe(true);
    expect(mapping.fields.map((entry) => entry.canonical_reference)).toEqual([
      `op://${VAULT_ID}/item/prod/key`,
      `op://${VAULT_ID}/item/beta/key`,
    ]);
  });

  test("a section label shadowing another section ID blocks the ambiguous selector", () => {
    const mapping = buildFieldMapping(
      [
        {
          id: "item",
          title: "item",
          fields: [
            {
              id: "key",
              label: "TOKEN",
              section: { id: "first", label: "production" },
              value: privateValue,
            },
            {
              id: "key",
              label: "TOKEN",
              section: { id: "second", label: "FIRST" },
              value: privateValue,
            },
          ],
        },
      ],
      [],
    );
    expect(mapping.fields[0]?.canonical_reference).toBeNull();
    expect(mapping.fields[1]?.canonical_reference).toBe(
      `op://${VAULT_ID}/item/second/key`,
    );
    expect(
      mapping.collisions.some(
        (collision) => collision.kind === "selector_alias",
      ),
    ).toBe(true);
  });
});
