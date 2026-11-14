import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  readSynthesizedConfiguration,
  synthesizedResources,
} from "homelab/scripts/tofu/synthesized-configuration.ts";

const SEAWEEDFS_TOFU_STACK = path.join(
  import.meta.dirname,
  "../../../../../tofu/seaweedfs",
);

const LifecycleResourceSchema = z.looseObject({
  input: z.record(z.string(), z.unknown()),
  provisioner: z
    .array(
      z.strictObject({
        "local-exec": z.looseObject({ command: z.string() }),
      }),
    )
    .length(1),
});

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

/** One `terraform_data` resource of the synthesized seaweedfs stack. */
async function lifecycleResource(name: string) {
  const configuration =
    await readSynthesizedConfiguration(SEAWEEDFS_TOFU_STACK);
  const resource = synthesizedResources(configuration, "terraform_data").find(
    (candidate) => candidate.name === name,
  );
  if (resource === undefined) throw new Error(`missing terraform_data.${name}`);
  return LifecycleResourceSchema.parse(resource.attributes);
}

/** The lifecycle JSON the provisioner sends, before interpolation. */
function lifecycleConfiguration(command: string) {
  const json = /--lifecycle-configuration '(?<json>[\s\S]*?)'/u.exec(command)
    ?.groups?.["json"];
  if (json === undefined) throw new Error("missing lifecycle configuration");
  // Quote the one interpolation so the template parses as JSON.
  return LifecycleConfigurationSchema.parse(
    JSON.parse(json.replace("${self.input.expire_days}", '"expire_days"')),
  );
}

describe("SeaweedFS ci-handoff bucket", () => {
  test("expires every object after 30 days", async () => {
    const resource = await lifecycleResource("ci_handoff_lifecycle");

    expect(resource.input["bucket"]).toBe("${aws_s3_bucket.ci_handoff.id}");
    // Handoffs are build-scoped; 30 days leaves room to inspect a failed run.
    expect(resource.input["expire_days"]).toBe(30);
    expect(
      lifecycleConfiguration(
        resource.provisioner[0]?.["local-exec"].command ?? "",
      ).Rules,
    ).toEqual([
      {
        ID: "expire-ci-handoff",
        Status: "Enabled",
        Filter: { Prefix: "" },
        Expiration: { Days: "expire_days" },
      },
    ]);
  });
});
