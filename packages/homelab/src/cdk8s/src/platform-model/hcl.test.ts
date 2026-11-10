import { describe, expect, test } from "vitest";
import {
  literalString,
  literalStrings,
  objectEntries,
  parseHcl,
} from "./hcl.ts";

const SOURCE = `
# A "quoted" comment with { braces
resource "cloudflare_dns_record" "apex" {
  zone_id = cloudflare_zone.example.id // trailing comment
  name    = "example.com"
  content = "\${var.tunnel}.cfargotunnel.com"
  proxied = true

  lifecycle { prevent_destroy = true }
}

locals {
  prefixes = {
    "site-a" = ["app/assets/", "_astro/"]
    site_b   = [
      "_astro/", # hashed
    ]
  }
  endpoints = { s3 = "https://s3.example", iam = "https://iam.example" }
}

resource "terraform_data" "lifecycle" {
  provisioner "local-exec" {
    command = <<-EOT
      aws s3api put --rules '{"Rules": [{"ID": "x"}]}' } {
    EOT
  }
  input = jsonencode({
    tagOwners = { "tag:k8s" = ["autogroup:admin"] }
  })
}
`;

describe("parseHcl", () => {
  const blocks = parseHcl(SOURCE);

  test("reads blocks, labels and attributes", () => {
    expect(blocks.map((block) => [block.type, ...block.labels])).toEqual([
      ["resource", "cloudflare_dns_record", "apex"],
      ["locals"],
      ["resource", "terraform_data", "lifecycle"],
    ]);
    const record = blocks[0];
    expect(Object.fromEntries(record?.attributes ?? [])).toEqual({
      zone_id: "cloudflare_zone.example.id",
      name: '"example.com"',
      content: '"${var.tunnel}.cfargotunnel.com"',
      proxied: "true",
    });
    expect(record?.blocks[0]?.attributes.get("prevent_destroy")).toBe("true");
  });

  test("keeps heredocs and nested expressions whole", () => {
    const data = blocks[2];
    expect(data?.blocks[0]?.attributes.get("command")).toContain(
      '\'{"Rules": [{"ID": "x"}]}\' } {',
    );
    expect(data?.attributes.get("input")).toContain('"tag:k8s"');
  });

  test("rejects syntax it does not know", () => {
    expect(() => parseHcl("resource oops")).toThrow(/expected attribute/);
    expect(() => parseHcl('name = "top-level"')).toThrow(/top-level attribute/);
    expect(() => parseHcl('resource "a" "b" {')).toThrow(/unbalanced/);
  });
});

describe("literals", () => {
  const locals = parseHcl(SOURCE)[1];

  test("literalString reads only plain strings", () => {
    expect(literalString('"example.com"')).toBe("example.com");
    expect(literalString('"${var.name}.example.com"')).toBeUndefined();
    expect(literalString("var.name")).toBeUndefined();
    expect(literalString(undefined)).toBeUndefined();
  });

  test("objectEntries and literalStrings read maps of string lists", () => {
    const prefixes = objectEntries(locals?.attributes.get("prefixes"));
    expect([...(prefixes ?? new Map<string, string>()).keys()]).toEqual([
      "site-a",
      "site_b",
    ]);
    expect(literalStrings(prefixes?.get("site-a"))).toEqual([
      "app/assets/",
      "_astro/",
    ]);
    expect(literalStrings(prefixes?.get("site_b"))).toEqual(["_astro/"]);
    expect(literalStrings("[var.a]")).toBeUndefined();
  });

  test("objectEntries reads comma-separated entries on one line", () => {
    const endpoints = objectEntries(locals?.attributes.get("endpoints"));
    expect(literalString(endpoints?.get("s3"))).toBe("https://s3.example");
    expect(literalString(endpoints?.get("iam"))).toBe("https://iam.example");
  });
});
