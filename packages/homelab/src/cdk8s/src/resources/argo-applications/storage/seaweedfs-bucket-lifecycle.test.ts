import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";

const BUCKETS_TF = path.join(
  import.meta.dirname,
  "../../../../../tofu/seaweedfs/buckets.tf",
);

/** The body of one top-level `resource "<type>" "<name>" { ... }` block. */
function resourceBlock(source: string, type: string, name: string): string {
  const header = `resource "${type}" "${name}" {`;
  const start = source.indexOf(header);
  if (start === -1) throw new Error(`missing ${type}.${name}`);
  const end = source.indexOf("\n}\n", start);
  if (end === -1) throw new Error(`unterminated ${type}.${name}`);
  return source.slice(start, end);
}

const LifecycleConfigurationSchema = z.strictObject({
  Rules: z.array(
    z.strictObject({
      ID: z.string(),
      Status: z.literal("Enabled"),
      Filter: z.strictObject({ Prefix: z.string() }),
      Expiration: z.strictObject({ Days: z.string() }),
    }),
  ),
});

/** The lifecycle JSON the block's provisioner sends, before interpolation. */
function lifecycleConfiguration(block: string) {
  const json = /--lifecycle-configuration '(?<json>[\s\S]*?)'/u.exec(block)
    ?.groups?.["json"];
  if (json === undefined) throw new Error("missing lifecycle configuration");
  // Quote the one interpolation so the template parses as JSON.
  return LifecycleConfigurationSchema.parse(
    JSON.parse(json.replace("${self.input.expire_days}", '"expire_days"')),
  );
}

describe("SeaweedFS ci-handoff bucket", () => {
  test("expires every object after 30 days", async () => {
    const source = await Bun.file(BUCKETS_TF).text();
    const block = resourceBlock(
      source,
      "terraform_data",
      "ci_handoff_lifecycle",
    );

    expect(block).toContain("bucket       = aws_s3_bucket.ci_handoff.id");
    // The longest a reader needs an earlier pipeline's handoff is the 24-hour
    // reviewed-plan window (scripts/tofu/platform-plan-handoff.ts).
    expect(block).toMatch(/expire_days\s*=\s*30\n/u);
    expect(lifecycleConfiguration(block).Rules).toEqual([
      {
        ID: "expire-ci-handoff",
        Status: "Enabled",
        Filter: { Prefix: "" },
        Expiration: { Days: "expire_days" },
      },
    ]);
  });
});
