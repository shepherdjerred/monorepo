import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize, synthesizedConfigurationPath } from "#scripts/synth.ts";

/**
 * The `for_each` of the asset lifecycle: a key added or dropped is a
 * lifecycle rule created or abandoned. The stack takes these from the
 * platform model's static sites, so a model edit that moves one shows here.
 */
const STATIC_SITE_IMMUTABLE_PREFIXES = {
  "better-skill-capped": ["assets/"],
  cook: ["_astro/"],
  "cross-compilers": ["_astro/"],
  "glitter-boys": ["_astro/"],
  "landing-pages": ["_astro/"],
  "scout-frontend": ["app/assets/", "_astro/"],
  "scout-frontend-beta": ["app/assets/", "_astro/"],
  "sjer-red": ["_astro/"],
  "stocks-sjer-red": ["_astro/"],
  "ts-mc": ["_astro/"],
  "ts-mc-docs": ["_astro/"],
  "wiki-sjer-red": ["_astro/"],
};

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown().optional(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  provider: z.unknown(),
  variable: z.record(z.string(), z.unknown()),
  locals: z.record(z.string(), z.unknown()),
  resource: z.strictObject({
    aws_s3_bucket: z.record(
      z.string(),
      z.strictObject({
        bucket: z.string(),
        force_destroy: z.literal(true).optional(),
        lifecycle: z
          .strictObject({ prevent_destroy: z.literal(true) })
          .optional(),
      }),
    ),
    terraform_data: z.record(z.string(), z.unknown()),
  }),
  import: z.array(z.object({ to: z.string(), id: z.string() })),
  removed: z.array(z.looseObject({ from: z.string() })),
  moved: z.unknown().optional(),
});

async function seaweedfs() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("seaweedfs") ?? ""),
  );
}

const ENDPOINT = "https://seaweedfs-s3.tailnet-1a49.ts.net";

/** Resource name to bucket name, for every bucket in the stack's state. */
const BUCKETS = {
  agent_chat_sessions: "agent-chat-sessions",
  apple_sdks: "apple-sdks",
  better_skill_capped: "better-skill-capped",
  brim_sessions: "brim-sessions",
  ci_handoff: "ci-handoff",
  clauderon: "clauderon",
  cook: "cook",
  cross_compilers: "cross-compilers",
  delivery_artifacts: "delivery-artifacts",
  glitter_boys: "glitter-boys",
  glitter_boys_ppl: "glitter-boys-ppl",
  glitter_discord_corpus: "glitter-discord-corpus",
  homelab_tofu_state: "homelab-tofu-state",
  landing_pages: "landing-pages",
  llm_archive: "llm-archive",
  public_sjer_red: "public-sjer-red",
  relay_docs: "relay-docs",
  resume: "resume",
  scout_beta: "scout-beta",
  scout_design_system: "scout-design-system",
  scout_frontend: "scout-frontend",
  scout_frontend_beta: "scout-frontend-beta",
  scout_prod: "scout-prod",
  scout_support_beta: "scout-support-beta",
  scout_support_prod: "scout-support-prod",
  sjer_red: "sjer-red",
  statically_typed: "statically-typed",
  stocks_sjer_red: "stocks-sjer-red",
  storm_forum_backups: "storm-forum-backups",
  storm_forum_releases: "storm-forum-releases",
  streambot_voice_captures: "streambot-voice-captures",
  the_storm_capture_fixtures: "the-storm-capture-fixtures",
  the_storm_rwf_recordings: "the-storm-rwf-recordings",
  tracker_attachments: "tracker-attachments",
  ts_mc: "ts-mc",
  ts_mc_docs: "ts-mc-docs",
  webring: "webring",
  wiki_sjer_red: "wiki-sjer-red",
};

/** Buckets whose destroy must fail to plan, the state bucket above all. */
const PROTECTED_BUCKETS = [
  "apple_sdks",
  "brim_sessions",
  "delivery_artifacts",
  "glitter_discord_corpus",
  "homelab_tofu_state",
  "relay_docs",
  "storm_forum_backups",
  "storm_forum_releases",
  "the_storm_capture_fixtures",
  "the_storm_rwf_recordings",
  "tracker_attachments",
];

const DEPLOY_ENVIRONMENT = "${local.seaweedfs_deploy_environment}";

const PUT_LIFECYCLE = [
  "aws s3api put-bucket-lifecycle-configuration \\",
  '  --bucket "${self.input.bucket}" \\',
  '  --endpoint-url "${self.input.endpoint_url}" \\',
  "",
].join("\n");

function provisioner(command: string) {
  return [{ "local-exec": { environment: DEPLOY_ENVIRONMENT, command } }];
}

/** An expiry `terraform_data`, with its script exactly as OpenTofu runs it. */
function expiry(bucket: string, days: number, rule: string, prefix: string) {
  return {
    input: {
      bucket: `\${aws_s3_bucket.${bucket}.id}`,
      expire_days: days,
      endpoint_url: ENDPOINT,
    },
    provisioner: provisioner(
      `${PUT_LIFECYCLE}${[
        "  --lifecycle-configuration '{",
        '    "Rules": [{',
        `      "ID": "${rule}",`,
        '      "Status": "Enabled",',
        `      "Filter": {"Prefix": "${prefix}"},`,
        '      "Expiration": {"Days": ${self.input.expire_days}}',
        "    }]",
        "  }'",
        "",
      ].join("\n")}`,
    ),
  };
}

/** Every `terraform_data` resource of the stack, in full. */
const TERRAFORM_DATA = {
  static_site_asset_lifecycle: {
    for_each: "${local.static_site_immutable_prefixes}",
    depends_on: [
      "aws_s3_bucket.scout_frontend",
      "aws_s3_bucket.scout_frontend_beta",
      "aws_s3_bucket.sjer_red",
      "aws_s3_bucket.cook",
      "aws_s3_bucket.cross_compilers",
      "aws_s3_bucket.stocks_sjer_red",
      "aws_s3_bucket.landing_pages",
      "aws_s3_bucket.wiki_sjer_red",
      "aws_s3_bucket.better_skill_capped",
      "aws_s3_bucket.ts_mc",
      "aws_s3_bucket.ts_mc_docs",
      "aws_s3_bucket.glitter_boys",
    ],
    input: {
      bucket: "${each.key}",
      endpoint_url: ENDPOINT,
      rules:
        '${jsonencode({ Rules = [for idx, prefix in each.value : { ID = "expire-old-hashed-${idx}", Status = "Enabled", Filter = { Prefix = prefix }, Expiration = { Days = 90 } }] })}',
    },
    provisioner: provisioner(
      `${PUT_LIFECYCLE}  --lifecycle-configuration '\${self.input.rules}'\n`,
    ),
  },
  public_sjer_red_lifecycle: expiry(
    "public_sjer_red",
    365,
    "expire-pr-assets",
    "pr/assets/",
  ),
  public_sjer_red_seed: {
    input: {
      bucket: "${aws_s3_bucket.public_sjer_red.id}",
      endpoint_url: ENDPOINT,
      index_md5: '${filemd5("${path.module}/public/index.html")}',
      not_found_md5: '${filemd5("${path.module}/public/404.html")}',
    },
    provisioner: provisioner(
      [
        'aws s3 cp "${path.module}/public/index.html" "s3://${self.input.bucket}/index.html" \\',
        '  --endpoint-url "${self.input.endpoint_url}" \\',
        '  --content-type "text/html; charset=utf-8"',
        'aws s3 cp "${path.module}/public/404.html" "s3://${self.input.bucket}/404.html" \\',
        '  --endpoint-url "${self.input.endpoint_url}" \\',
        '  --content-type "text/html; charset=utf-8"',
        "",
      ].join("\n"),
    ),
  },
  llm_archive_lifecycle: expiry("llm_archive", 365, "expire-llm-archives", ""),
  streambot_voice_captures_lifecycle: expiry(
    "streambot_voice_captures",
    90,
    "expire-streambot-voice-captures",
    "voice-captures/",
  ),
  ci_handoff_lifecycle: expiry("ci_handoff", 30, "expire-ci-handoff", ""),
};

describe("seaweedfs", () => {
  test("keeps every bucket address, its protection, imports and the forgotten bucket", async () => {
    const { resource, terraform, ...stack } = await seaweedfs();
    const buckets = resource.aws_s3_bucket;
    expect(
      Object.fromEntries(
        Object.entries(buckets).map(([name, bucket]) => [name, bucket.bucket]),
      ),
    ).toEqual(BUCKETS);
    expect(
      Object.keys(buckets).filter(
        (name) => buckets[name]?.lifecycle !== undefined,
      ),
    ).toEqual(PROTECTED_BUCKETS);
    expect(
      Object.keys(buckets).filter(
        (name) => buckets[name]?.force_destroy !== undefined,
      ),
    ).toEqual(["clauderon"]);

    expect(stack.import).toEqual([
      { id: "apple-sdks", to: "aws_s3_bucket.apple_sdks" },
      { id: "stocks-sjer-red", to: "aws_s3_bucket.stocks_sjer_red" },
      { id: "relay-docs", to: "aws_s3_bucket.relay_docs" },
      { id: "ci-handoff", to: "aws_s3_bucket.ci_handoff" },
    ]);
    expect(stack.removed).toEqual([
      {
        from: "aws_s3_bucket.scout_classic_fonts",
        lifecycle: { destroy: false },
      },
    ]);
    expect(stack.moved).toBeUndefined();
    expect(terraform.encryption).toBeUndefined();
    // The lock file records this constraint; a different one rewrites it.
    expect(terraform.required_providers).toEqual({
      aws: { source: "hashicorp/aws", version: "~> 6.55" },
    });
    expect(terraform).toMatchObject({
      required_version: ">= 1.6.0",
      backend: {
        s3: {
          bucket: "homelab-tofu-state",
          key: "seaweedfs/terraform.tfstate",
          endpoints: { s3: ENDPOINT },
          use_lockfile: true,
        },
      },
    });
  });

  test("the deployment identity reaches the provider and provisioners", async () => {
    const { variable, locals, provider } = await seaweedfs();
    expect(variable).toEqual({
      seaweedfs_access_key_id: {
        description: "SeaweedFS S3 deployment identity access key",
        sensitive: true,
        type: "string",
      },
      seaweedfs_secret_access_key: {
        description: "SeaweedFS S3 deployment identity secret key",
        sensitive: true,
        type: "string",
      },
    });
    // Environment names and bucket names are data, not snake_cased.
    expect(locals).toEqual({
      seaweedfs_deploy_environment: {
        AWS_ACCESS_KEY_ID: "${var.seaweedfs_access_key_id}",
        AWS_SECRET_ACCESS_KEY: "${var.seaweedfs_secret_access_key}",
      },
      static_site_immutable_prefixes: STATIC_SITE_IMMUTABLE_PREFIXES,
    });
    expect(provider).toEqual({
      aws: [
        {
          access_key: "${var.seaweedfs_access_key_id}",
          secret_key: "${var.seaweedfs_secret_access_key}",
          region: "us-east-1",
          skip_credentials_validation: true,
          skip_metadata_api_check: "true",
          skip_requesting_account_id: true,
          s3_use_path_style: true,
          endpoints: [{ s3: ENDPOINT }],
        },
      ],
    });
  });

  test("keeps every lifecycle and seed provisioner byte for byte", async () => {
    const { resource } = await seaweedfs();
    // OpenTofu never plans a provisioner change, so the zero-change plan
    // cannot see one: the scripts are pinned here instead.
    expect(resource.terraform_data).toEqual(TERRAFORM_DATA);
  });

  test("the seed pages the stack hashes and uploads are committed beside it", async () => {
    const stackDirectory = path.dirname(
      synthesizedConfigurationPath("seaweedfs"),
    );
    for (const page of ["index.html", "404.html"])
      expect(
        await Bun.file(path.join(stackDirectory, "public", page)).exists(),
        page,
      ).toBe(true);
  });
});
