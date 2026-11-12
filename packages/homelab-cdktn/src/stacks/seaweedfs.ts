import type { Construct } from "constructs";
import {
  DataResource,
  TerraformIterator,
  TerraformLocal,
  TerraformVariable,
  Token,
} from "cdktn";
import type { LocalExecProvisioner } from "cdktn";
import { AwsProvider } from "#generated/providers/aws/provider/index.ts";
import { S3Bucket } from "#generated/providers/aws/s3-bucket/index.ts";
import {
  HomelabStack,
  STATE_BUCKET,
  STATE_ENDPOINT,
} from "#src/homelab-stack.ts";
import {
  consumedBucket,
  declaredBuckets,
  immutablePrefixesByBucket,
  staticSite,
} from "homelab/src/platform-model.ts";
import { forget, protect } from "#src/state-migrations.ts";

/**
 * Expire old content-hashed assets 90 days after they were last written. The
 * (now-removed) CI site deploy uploaded these prefixes with a 1-year
 * `immutable` Cache-Control and WITHOUT `--delete`, so a deploy never 404s a
 * hashed chunk that a still-open browser tab references. Any future manual
 * deploy should follow the same convention: re-upload the current build's
 * hashed files (fresh mtime resets their age) so only prior builds' hashes
 * age out.
 *
 * The prefixes are each static site's `immutablePrefixes` in the platform
 * model (`packages/homelab/src/platform-model.json`), which the `cloudflare`
 * stack caches as immutable. A site with none there has no rule here:
 * non-hashed sites (resume, webring), and `scout-design-system`, whose
 * Storybook chunks share the `assets/` prefix with the unhashed Scout game
 * art, fonts, and theme bootstrap that scoutAssetsPlugin copies in, so an
 * immutable rule there would pin those forever.
 */
function staticSiteImmutablePrefixes(): Record<string, readonly string[]> {
  return {
    ...Object.fromEntries(immutablePrefixesByBucket()),
    ...RETAINED_IMMUTABLE_PREFIXES,
  };
}

/**
 * Expiry rules of buckets no static site serves, so the model has no site to
 * declare them on. The both-sides test lists each as debt
 * (`cdk8s/src/platform-model/debt-allowlists.ts`).
 */
const RETAINED_IMMUTABLE_PREFIXES = {
  // Retained assets from the retired Astro portal; no active site deploys here.
  "ts-mc": ["_astro/"],
} as const;

/** The lifecycle call every expiry provisioner opens with. */
const PUT_LIFECYCLE = [
  "aws s3api put-bucket-lifecycle-configuration \\",
  '  --bucket "${self.input.bucket}" \\',
  '  --endpoint-url "${self.input.endpoint_url}" \\',
];

/**
 * A provisioner script: each line ended by a newline. The text is an OpenTofu
 * template, so `${self.input.…}` is resolved by OpenTofu, not here.
 */
function script(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

type BucketOptions = {
  /** `lifecycle { prevent_destroy = true }`. */
  readonly protected?: true;
  /** Adopt a bucket that existed before its declaration (`import` block). */
  readonly adopt?: true;
  readonly forceDestroy?: true;
};

type Expiry = {
  readonly bucket: S3Bucket;
  readonly days: number;
  /** The lifecycle rule's `ID`. */
  readonly rule: string;
  /** Key prefix the rule covers; empty for every object. */
  readonly prefix: string;
};

/**
 * All S3 buckets on the self-hosted SeaweedFS instance, managed through the
 * AWS provider with a custom S3 endpoint, including the bucket that holds
 * every stack's OpenTofu state.
 *
 * SeaweedFS has no lifecycle resource the provider can manage, so lifecycle
 * rules and the public bucket's seed pages are `terraform_data` resources
 * whose `local-exec` provisioners call the AWS CLI.
 */
export class SeaweedfsStack extends HomelabStack {
  /**
   * OpenTofu's S3 backend intentionally inherits the state-only AWS identity
   * from the process. The AWS CLI provisioners mutate deployment buckets, so
   * those child processes are given the separate deployment identity
   * explicitly.
   */
  private readonly deployEnvironment: Record<string, string>;

  /** Every bucket of the stack by its name, in the order it was declared. */
  private readonly buckets = new Map<string, S3Bucket>();

  constructor(scope: Construct) {
    super(scope, "seaweedfs", {
      requiredVersion: ">= 1.6.0",
      providerConstraints: { aws: "~> 6.55" },
    });

    const accessKeyId = new TerraformVariable(this, "seaweedfs_access_key_id", {
      description: "SeaweedFS S3 deployment identity access key",
      type: "string",
      sensitive: true,
    });
    const secretAccessKey = new TerraformVariable(
      this,
      "seaweedfs_secret_access_key",
      {
        description: "SeaweedFS S3 deployment identity secret key",
        type: "string",
        sensitive: true,
      },
    );

    new AwsProvider(this, "aws", {
      accessKey: accessKeyId.stringValue,
      secretKey: secretAccessKey.stringValue,
      region: "us-east-1",
      skipCredentialsValidation: true,
      // The provider declares this one flag as a string.
      skipMetadataApiCheck: "true",
      skipRequestingAccountId: true,
      s3UsePathStyle: true,
      endpoints: [{ s3: STATE_ENDPOINT }],
    });

    const immutablePrefixes = staticSiteImmutablePrefixes();
    new TerraformLocal(
      this,
      "static_site_immutable_prefixes",
      // Bucket names are data: a plain object would have its keys snake_cased.
      Token.asAny(immutablePrefixes),
    );
    this.deployEnvironment = new TerraformLocal(
      this,
      "seaweedfs_deploy_environment",
      Token.asAny({
        AWS_ACCESS_KEY_ID: accessKeyId.stringValue,
        AWS_SECRET_ACCESS_KEY: secretAccessKey.stringValue,
      }),
    ).asStringMap;

    // A bucket the platform model declares takes its name from there: a
    // static site's by its hostname, a consumer's by the environment variable
    // its workloads name it in. A bucket is declared below when the stack has
    // something to add to it (protection, an adoption, a lifecycle); the rest
    // of the model's buckets are created after them, so a site or consumer
    // added to the model needs no line here.
    //
    // `import` blocks and the `depends_on` of the asset lifecycle are written
    // in declaration order. Neither order means anything to OpenTofu, but the
    // statements keep theirs so the synthesized configuration does not move.

    // Private. The Apple SDK tarballs the published macos-cross-compiler
    // images are built from (packages/macos-cross-compiler/scripts/stage-xcode.sh),
    // pinned by sha256 in its sdks.json. Re-staging one needs a Mac with that
    // exact Xcode installed, so the objects are backed up rather than treated
    // as rebuildable.
    //
    // The first tarball upload (scripts/release/macos-cross-compiler.ts upload)
    // created the bucket before this resource reached main (SeaweedFS creates
    // a bucket on its first PutObject), so adopt it instead of calling
    // CreateBucket.
    this.bucket("apple-sdks", { adopt: true, protected: true });

    // Static sites with content-hashed assets (served via Caddy s3proxy).
    this.site("scout-for-lol.com");
    this.site("beta.scout-for-lol.com");
    this.site("sjer.red");
    this.site("cook.sjer.red");
    // The macOS + Windows cross-compiler marketing site.
    this.site("cross-compilers.sjer.red");
    // This bucket predates its IaC declaration: when stocks was wired into
    // the deploy (commit 6d0aa524b) it was added to CI + Caddy + the Astro
    // app but never to this stack, and SeaweedFS's S3 gateway auto-created it
    // on the first deploy sync (it auto-creates a bucket on first PutObject,
    // unlike AWS S3). The `import` block adopts the existing bucket rather
    // than letting Tofu try to CreateBucket over it. It is a no-op once the
    // bucket is in state.
    this.site("stocks.sjer.red", { adopt: true });
    // Shared landing and campaign pages (packages/landing-pages).
    this.site("public.ts-mc.net");
    this.site("wiki.sjer.red");
    this.site("better-skill-capped.com");
    // See RETAINED_IMMUTABLE_PREFIXES.
    this.bucket("ts-mc");
    this.site("docs.ts-mc.net");
    this.site("glitter-boys.com");

    // The archived Clauderon site is retired (see cloudflare/clauderon-com.tf),
    // but the bucket still holds its objects. Removing this resource in the
    // same PR that first sets force_destroy would plan a destroy against state
    // that has never actually had force_destroy applied: the removal and the
    // force_destroy change can only land together, and a squash-merged PR is a
    // single tofu apply, so the destroy would still fail on a non-empty
    // bucket. Land force_destroy here, let it apply to prod, THEN remove this
    // resource in a follow-up PR once that apply has completed.
    this.site("clauderon.com", { forceDestroy: true });

    // Private buckets are intentionally absent from the Caddy public bucket
    // inventory.
    this.bucket("the-storm-capture-fixtures", { protected: true });
    this.consumed({ env: "BUNDLE_BUCKET" }, { protected: true });
    this.bucket("storm-forum-backups", { protected: true });
    this.consumed(
      { env: "S3_BUCKET", namespace: "tracker" },
      { protected: true },
    );

    // Private, loss-intolerant raw Discord corpus. Immutable response pages,
    // manifests, and projections are mirrored to R2 before a snapshot pointer
    // is advanced. No expiry: Discord history and captured deletions are not
    // reliably reconstructible.
    this.consumed({ env: "GLITTER_CORPUS_S3_BUCKET" }, { protected: true });

    // Private. Archived Red Warfare match recordings (pseudonymous, for
    // review and bot training). The Temporal archive confirms each copy here
    // before marking the recording archived, after which The Storm's
    // retention may delete the server's copy, so this bucket becomes the only
    // copy. No expiry.
    this.consumed({ env: "RWF_ARCHIVE_S3_BUCKET" }, { protected: true });

    // Document CRDT state + attachments for the self-hosted Relay Server
    // (Obsidian real-time collaboration). See
    // packages/homelab/src/cdk8s/src/resources/relay.
    //
    // relay-docs was created before this resource reached main, then manually
    // recreated after a cross-checkout tofu apply deleted it. Adopt the
    // existing bucket into state instead of trying CreateBucket over it.
    this.bucket("relay-docs", { adopt: true, protected: true });

    // Public artifact bucket, served at https://public.sjer.red via Caddy
    // s3proxy. PR screenshots live under the `pr/assets/<number>/` prefix
    // (365-day TTL, below); the bucket root is seeded with a landing + 404
    // page so the static-site root probe stays green.
    const publicSjerRed = this.site("public.sjer.red");

    // Expire PR-asset objects after 365 days. Scoped to the `pr/assets/`
    // prefix so any other public artifacts dropped in this bucket are
    // retained indefinitely.
    this.expiry("public_sjer_red_lifecycle", {
      bucket: publicSjerRed,
      days: 365,
      rule: "expire-pr-assets",
      prefix: "pr/assets/",
    });

    // Seed the bucket root with a landing + 404 page so `GET /` returns 200
    // (keeps the static-site root blackbox probe green). Re-uploads whenever
    // either file's content changes via the filemd5 values in `input`.
    new DataResource(this, "public_sjer_red_seed", {
      input: {
        bucket: publicSjerRed.id,
        endpoint_url: STATE_ENDPOINT,
        index_md5: '${filemd5("${path.module}/public/index.html")}',
        not_found_md5: '${filemd5("${path.module}/public/404.html")}',
      },
      provisioners: [
        this.deploy([
          'aws s3 cp "${path.module}/public/index.html" "s3://${self.input.bucket}/index.html" \\',
          '  --endpoint-url "${self.input.endpoint_url}" \\',
          '  --content-type "text/html; charset=utf-8"',
          'aws s3 cp "${path.module}/public/404.html" "s3://${self.input.bucket}/404.html" \\',
          '  --endpoint-url "${self.input.endpoint_url}" \\',
          '  --content-type "text/html; charset=utf-8"',
        ]),
      ],
    });

    // Private user screenshots, never included in a static/public asset route.
    this.consumed({ env: "SUPPORT_BUCKET_NAME", namespace: "scout-beta" });
    this.consumed({ env: "SUPPORT_BUCKET_NAME", namespace: "scout-prod" });

    // The Scout League Classic renderer now ships Gill Sans committed in the
    // repo under the owner's universal redistribution license, so the private
    // `scout-classic-fonts` bucket is no longer needed. Stop managing it here
    // without destroying the physical bucket; an operator decommissions the
    // bucket and its objects out-of-band. No-op if the resource was never in
    // state.
    forget(this, "aws_s3_bucket.scout_classic_fonts");

    // LLM request/response archive: gzipped JSON envelopes per LLM call.
    // Written by packages/llm-observability's LlmArchiveSpanProcessor; one
    // file per call, key prefix
    // `llm/<service>/<provider>/YYYY/MM/DD/<traceId>-<spanId>.json.gz`.
    // 1-year retention to support cost analysis and prompt regression
    // debugging.
    const llmArchive = this.consumed({ env: "LLM_ARCHIVE_S3_BUCKET" });

    // Durable provider resume state for Temporal agent chats. Unlike the
    // request archive, these objects have no age-based lifecycle: an idle
    // chat must remain resumable until its catalog record is explicitly
    // retired.
    this.bucket("agent-chat-sessions");

    // Encrypted Claude Code and Codex transcript archive written by
    // `brim sync push` on each workstation
    // (packages/toolkit/src/lib/brim/sync). Objects are age-encrypted
    // client-side; keys are opaque. No age-based lifecycle: the archive is
    // the permanent backup of every machine's agent history. Access is the
    // scoped `brim-sync` gateway identity only.
    this.bucket("brim-sessions", { protected: true });

    this.expiry("llm_archive_lifecycle", {
      bucket: llmArchive,
      days: 365,
      rule: "expire-llm-archives",
      prefix: "",
    });

    // Private Streambot diagnostic audio. Captures are intentionally
    // ephemeral and are not mirrored or backed up: their purpose is
    // short-lived voice-path diagnosis, and they may contain user speech,
    // Discord IDs, and transcripts.
    const streambotVoiceCaptures = this.consumed({
      env: "VOICE_CAPTURE_BUCKET",
    });
    this.expiry("streambot_voice_captures_lifecycle", {
      bucket: streambotVoiceCaptures,
      days: 90,
      rule: "expire-streambot-voice-captures",
      prefix: "voice-captures/",
    });

    // Build-scoped CI handoff and artifact store. Steps pass values to later
    // steps in the same pipeline as `<pipeline number>/<key>.json`, and
    // directory trees under `artifacts/`; see scripts/lib/ci/ci-handoff.ts
    // and ci-artifact.ts.
    //
    // Declared so the handoff S3 identity has a bucket named in IaC to be
    // scoped against. That identity is not repo-managed: SeaweedFS reads its
    // identities from the `seaweedfs-s3-credentials` 1Password item through
    // `existingConfigSecret`, so nothing here can assert the scope. Scope it
    // to the BUCKET rather than a prefix: one bucket carries both the JSON
    // keys and the `artifacts/` trees, and a prefix-scoped grant would break
    // the artifact half while the handoff half kept working.
    //
    // The import block is here because the bucket already exists: it was
    // created empty, ahead of this declaration, precisely so that adoption is
    // a fact rather than a race. Left to itself, `verify` would write the
    // caddyfile handoff on every build including pull requests before any
    // apply ran, SeaweedFS would auto-create the bucket on that first
    // PutObject, and every subsequent apply would fail with
    // BucketAlreadyExists. Creating it up front removes the ordering question
    // entirely.
    const ciHandoff = this.bucket("ci-handoff", { adopt: true });

    // Every handoff value and artifact tree is build-scoped: steps read only
    // their own pipeline's keys, and the one cross-pipeline read, a reviewed
    // platform plan (packages/homelab/scripts/tofu/platform-plan-handoff.ts),
    // is refused once it is 24 hours old. Thirty days leaves room to inspect
    // a failed run's diagnostics (`toolkit ci analyze` defaults to 72 hours)
    // without letting the bucket grow without bound. Anything that must
    // outlive that belongs in a durable bucket, not here.
    this.expiry("ci_handoff_lifecycle", {
      bucket: ciHandoff,
      days: 30,
      rule: "expire-ci-handoff",
      prefix: "",
    });

    // Immutable deployment artifacts outlive the producing CI pipeline. No
    // age-based lifecycle: active environment pins and retained rollback
    // revisions own retention. Provision this bucket before enabling archive
    // publication; never rely on S3's implicit bucket creation from the first
    // PutObject.
    this.bucket("delivery-artifacts", { protected: true });

    // OpenTofu state backend for all modules.
    this.bucket(STATE_BUCKET, { protected: true });

    // Every other bucket the model declares: static sites without hashed
    // assets, and application storage with nothing to add here.
    for (const name of declaredBuckets())
      if (!this.buckets.has(name)) this.bucket(name);

    const site = TerraformIterator.fromMap(
      Token.asAnyMap("${local.static_site_immutable_prefixes}"),
    );
    new DataResource(this, "static_site_asset_lifecycle", {
      forEach: site,
      // Ensure the bucket exists before configuring its lifecycle.
      dependsOn: this.bucketsNamed(Object.keys(immutablePrefixes)),
      input: {
        bucket: site.key,
        endpoint_url: STATE_ENDPOINT,
        // Re-runs the provisioner whenever the prefix set or TTL changes.
        rules:
          '${jsonencode({ Rules = [for idx, prefix in each.value : { ID = "expire-old-hashed-${idx}", Status = "Enabled", Filter = { Prefix = prefix }, Expiration = { Days = 90 } }] })}',
      },
      provisioners: [
        this.deploy([
          ...PUT_LIFECYCLE,
          "  --lifecycle-configuration '${self.input.rules}'",
        ]),
      ],
    });
  }

  /**
   * `aws_s3_bucket.<name with underscores>`, directly in the stack scope.
   * The address is derived from the name, as every bucket's always was.
   */
  private bucket(name: string, options: BucketOptions = {}): S3Bucket {
    const bucket = new S3Bucket(this, name.replaceAll("-", "_"), {
      bucket: name,
      ...(options.forceDestroy === true ? { forceDestroy: true } : {}),
    });
    if (options.adopt === true) bucket.importFrom(name);
    if (options.protected === true) protect(bucket);
    this.buckets.set(name, bucket);
    return bucket;
  }

  /** The bucket the model's static site at `hostname` is served from. */
  private site(hostname: string, options: BucketOptions = {}): S3Bucket {
    return this.bucket(staticSite(hostname).bucket, options);
  }

  /** The bucket a namespace's workloads name through `env` in the model. */
  private consumed(
    consumer: Parameters<typeof consumedBucket>[0],
    options: BucketOptions = {},
  ): S3Bucket {
    return this.bucket(consumedBucket(consumer), options);
  }

  /**
   * The stack's buckets with these names, in declaration order. A name with
   * no bucket is a lifecycle rule for a bucket nothing creates.
   */
  private bucketsNamed(names: readonly string[]): S3Bucket[] {
    const missing = names.filter((name) => !this.buckets.has(name));
    if (missing.length > 0)
      throw new Error(
        `The seaweedfs stack declares no bucket named ${missing.join(", ")}`,
      );
    return [...this.buckets]
      .filter(([name]) => names.includes(name))
      .map(([, bucket]) => bucket);
  }

  /** A `local-exec` provisioner running `lines` as the deployment identity. */
  private deploy(lines: readonly string[]): LocalExecProvisioner {
    return {
      type: "local-exec",
      environment: this.deployEnvironment,
      command: script(lines),
    };
  }

  /**
   * `terraform_data.<id>`: one lifecycle rule expiring a bucket's objects
   * under `prefix` after `days`.
   */
  private expiry(id: string, expiry: Expiry): void {
    new DataResource(this, id, {
      input: {
        bucket: expiry.bucket.id,
        expire_days: expiry.days,
        endpoint_url: STATE_ENDPOINT,
      },
      provisioners: [
        this.deploy([
          ...PUT_LIFECYCLE,
          "  --lifecycle-configuration '{",
          '    "Rules": [{',
          `      "ID": "${expiry.rule}",`,
          '      "Status": "Enabled",',
          `      "Filter": {"Prefix": "${expiry.prefix}"},`,
          '      "Expiration": {"Days": ${self.input.expire_days}}',
          "    }]",
          "  }'",
        ]),
      ],
    });
  }
}
