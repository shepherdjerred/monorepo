import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { S3Client } from "bun";
import { z } from "zod";
import { forumManifest } from "#src/config.ts";

// Run through scripts/onepassword/with-service-account.sh. All credential
// transfers use subprocess pipes or memory; the output contains release pins only.
const vault = "v64ocnykdqju4ui6j6pua56xw4";
const gatewayItem = "vet52jaeh75chsalu6lulugium";
const stateItem = "eyfsbfkxojth6ymr65l47yyfxy";
const endpoint = "https://seaweedfs-s3.tailnet-1a49.ts.net";
const title = "storm-forum-prod";
const ItemSchema = z
  .object({
    id: z.string(),
    fields: z.array(
      z.object({ label: z.string(), value: z.string().optional() }).loose(),
    ),
  })
  .loose();
type Item = z.infer<typeof ItemSchema>;
const PostalSchema = z.object({
  smtpPassword: z.string().min(1),
  dkimName: z.string(),
  dkimRecord: z.string(),
  verificationRecord: z.string(),
});
type Postal = z.infer<typeof PostalSchema>;
type Bundle = { archivePath: string; bundleSha256: string; bundleKey: string };

export async function productionCommand(
  args: string[],
  input?: string,
): Promise<string> {
  const commandName = path.basename(args[0] ?? "command");
  // Bun subprocess input is a socket. The 1Password CLI recognizes templates
  // only on an OS pipe; cat creates that pipe without putting values in argv.
  const executable =
    input === undefined
      ? args
      : [
          "bash",
          "-o",
          "pipefail",
          "-c",
          'cat | "$@"',
          "storm-forum-input",
          ...args,
        ];
  const child = Bun.spawn(executable, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  if (input !== undefined) await child.stdin.write(input);
  await child.stdin.end();
  const [stdout, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) {
    // CLI errors can echo serialized templates, including nested gateway keys.
    // Keep both failed-command streams private rather than attempting redaction.
    throw new Error(`${commandName} exited ${String(code)}`);
  }
  return stdout;
}

async function op(args: string[], input?: unknown): Promise<unknown> {
  return JSON.parse(
    await productionCommand(
      ["op", "item", ...args, "--vault", vault, "--format=json"],
      input === undefined ? undefined : JSON.stringify(input),
    ),
  ) as unknown;
}

function field(item: Item, label: string): string {
  const value = item.fields.find((entry) => entry.label === label)?.value;
  if (value === undefined || value === "")
    throw new Error(`Required 1Password field missing: ${label}`);
  return value;
}

function s3(item: Item, bucket: string, prefix: string): S3Client {
  return new S3Client({
    endpoint,
    region: "us-east-1",
    bucket,
    accessKeyId: field(item, `${prefix}_ACCESS_KEY_ID`),
    secretAccessKey: field(item, `${prefix}_SECRET_ACCESS_KEY`),
  });
}

async function packageBundle(
  upload: string,
  styles: string,
  destination: string,
): Promise<Bundle> {
  if (await Bun.file(path.join(upload, "src/config.php")).exists()) {
    throw new Error(
      "Use the unconfigured licensed distribution, not an installed forum",
    );
  }
  const xf = await Bun.file(path.join(upload, "src/XF.php")).text();
  if (!xf.includes(forumManifest.xenforoVersion)) {
    throw new Error(
      "The licensed distribution version does not match the manifest",
    );
  }
  for (const dependency of forumManifest.vendorDependencies) {
    if (dependency.kind !== "style") {
      throw new Error(
        "Production packaging requires the manifest's pinned style archives",
      );
    }
    const archive = path.join(styles, path.basename(dependency.path));
    const digest = createHash("sha256")
      .update(Buffer.from(await Bun.file(archive).arrayBuffer()))
      .digest("hex");
    if (digest !== dependency.sha256)
      throw new Error(`Style checksum mismatch: ${dependency.key}`);
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const archivePath = path.join(destination, "private-release.zip");
  await productionCommand([
    "python3",
    "-c",
    `
import pathlib, stat, sys, zipfile
upload, styles, output = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for root, prefix in [(upload, ''), (styles, 'vendor/')]:
        files = sorted(root.rglob('*')) if not prefix else sorted(root.glob('flexile-storm-*.zip'))
        for file in files:
            if file.is_symlink(): raise RuntimeError('Private inputs cannot contain symlinks')
            if not file.is_file(): continue
            info = zipfile.ZipInfo(prefix + file.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, file.read_bytes())
`,
    upload,
    styles,
    archivePath,
  ]);
  const bundleSha256 = createHash("sha256")
    .update(Buffer.from(await Bun.file(archivePath).arrayBuffer()))
    .digest("hex");
  const bundleKey = `releases/${bundleSha256}.zip`;
  return { archivePath, bundleSha256, bundleKey };
}

async function loadStorage(): Promise<{
  gateway: Item;
  releases: S3Client;
  siteKey: string;
  captchaKey: string;
}> {
  const gateway = ItemSchema.parse(await op(["get", gatewayItem]));
  const backend = ItemSchema.parse(await op(["get", stateItem]));
  const state = z
    .object({
      outputs: z.record(z.string(), z.object({ value: z.unknown() }).loose()),
    })
    .parse(
      await s3(backend, "homelab-tofu-state", "SEAWEEDFS_TOFU_STATE")
        .file("cloudflare/terraform.tfstate")
        .json(),
    );
  const siteKey = z
    .string()
    .min(1)
    .parse(state.outputs["storm_forum_turnstile_site_key"]?.value);
  const captchaKey = z
    .string()
    .min(1)
    .parse(state.outputs["storm_forum_turnstile_secret_key"]?.value);
  const releases = s3(gateway, "storm-forum-releases", "SEAWEEDFS");
  const backups = s3(gateway, "storm-forum-backups", "SEAWEEDFS");
  await releases.list({ maxKeys: 1 });
  await backups.list({ maxKeys: 1 });
  return { gateway, releases, siteKey, captchaKey };
}

async function preparePostal(): Promise<Postal> {
  const postalOutput = await productionCommand(
    [
      "kubectl",
      "exec",
      "-i",
      "-n",
      "postal",
      "deployment/postal-postal-web",
      "--",
      "bin/rails",
      "runner",
      "-",
    ],
    `
server = Server.find_by!(permalink: 'jerred')
domain = Domain.find_or_create_by!(owner: server, name: 'ts-mc.net') do |record|
  record.verification_method = 'DNS'
  record.incoming = false
  record.outgoing = true
end
credential = Credential.find_or_create_by!(server: server, name: 'storm-forum-prod') do |record|
  record.type = 'SMTP'
end
puts({smtpPassword: credential.key, dkimName: domain.dkim_record_name, dkimRecord: domain.dkim_record, verificationRecord: domain.dns_verification_string}.to_json)
`,
  );
  return PostalSchema.parse(
    JSON.parse(postalOutput.trim().split("\n").at(-1) ?? ""),
  );
}

async function prepareRuntime(
  siteKey: string,
  captchaKey: string,
  postal: Postal,
): Promise<Item> {
  const listed = z
    .array(z.object({ id: z.string(), title: z.string() }))
    .parse(await op(["list"]));
  const existing = listed.find((entry) => entry.title === title);
  if (existing !== undefined) {
    const runtime = ItemSchema.parse(await op(["get", existing.id]));
    if (field(runtime, "POSTAL_SMTP_PASSWORD") !== postal.smtpPassword) {
      throw new Error(
        "The stored Postal credential does not match the named production credential",
      );
    }
    return runtime;
  }
  const values = {
    DB_PASSWORD: randomBytes(32).toString("hex"),
    MARIADB_ROOT_PASSWORD: randomBytes(32).toString("hex"),
    BUNDLE_ACCESS_KEY: randomBytes(16).toString("hex"),
    BUNDLE_SECRET_KEY: randomBytes(32).toString("hex"),
    BACKUP_ACCESS_KEY: randomBytes(16).toString("hex"),
    BACKUP_SECRET_KEY: randomBytes(32).toString("hex"),
    POSTAL_SMTP_USERNAME: "XX",
    POSTAL_SMTP_PASSWORD: postal.smtpPassword,
    TURNSTILE_SITE_KEY: siteKey,
    TURNSTILE_SECRET_KEY: captchaKey,
    ADMIN_USERNAME: "Jerred",
    ADMIN_EMAIL: "derrej@sjer.red",
    ADMIN_PASSWORD: randomBytes(32).toString("base64url"),
  };
  const created = ItemSchema.parse(
    await op(["create", "-"], {
      category: "API_CREDENTIAL",
      title,
      fields: Object.entries(values).map(([label, value]) => ({
        id: label,
        label,
        type: "CONCEALED",
        value,
      })),
    }),
  );
  return ItemSchema.parse(await op(["get", created.id]));
}

async function prepareGateway(gateway: Item, runtime: Item): Promise<boolean> {
  const ConfigSchema = z
    .object({
      identities: z.array(
        z
          .object({
            name: z.string(),
            actions: z.array(z.string()),
            credentials: z.array(
              z
                .object({ accessKey: z.string(), secretKey: z.string() })
                .loose(),
            ),
          })
          .loose(),
      ),
    })
    .loose();
  const config = ConfigSchema.parse(
    JSON.parse(field(gateway, "seaweedfs_s3_config")),
  );
  let changed = false;
  for (const [name, bucket, prefix, actions] of [
    [
      "storm-forum-prod-bundle",
      "storm-forum-releases",
      "BUNDLE",
      ["Read", "List"],
    ],
    [
      "storm-forum-prod-backup",
      "storm-forum-backups",
      "BACKUP",
      ["Read", "Write", "List"],
    ],
  ] as const) {
    const identity = config.identities.find((entry) => entry.name === name);
    const credential = {
      accessKey: field(runtime, `${prefix}_ACCESS_KEY`),
      secretKey: field(runtime, `${prefix}_SECRET_KEY`),
    };
    const scopedActions = actions.map((action) => `${action}:${bucket}`);
    if (identity) {
      if (
        JSON.stringify(identity.credentials) !== JSON.stringify([credential]) ||
        JSON.stringify(identity.actions) !== JSON.stringify(scopedActions)
      ) {
        throw new Error(
          `Existing S3 identity differs from the production item: ${name}`,
        );
      }
    } else {
      config.identities.push({
        name,
        credentials: [credential],
        actions: scopedActions,
      });
      changed = true;
    }
  }
  if (changed) {
    const target = gateway.fields.find(
      (entry) => entry.label === "seaweedfs_s3_config",
    );
    if (!target) throw new Error("Missing S3 identity configuration field");
    target.value = JSON.stringify(config);
    await op(["edit", gatewayItem], gateway);
  }
  return changed;
}

async function uploadBundle(releases: S3Client, bundle: Bundle): Promise<void> {
  const { archivePath, bundleSha256, bundleKey } = bundle;
  if (await releases.file(bundleKey).exists()) {
    const digest = createHash("sha256")
      .update(Buffer.from(await releases.file(bundleKey).arrayBuffer()))
      .digest("hex");
    if (digest !== bundleSha256)
      throw new Error("An immutable release bundle has different bytes");
  } else {
    await releases
      .file(bundleKey)
      .write(Bun.file(archivePath), { type: "application/zip" });
  }
  const uploaded = createHash("sha256")
    .update(Buffer.from(await releases.file(bundleKey).arrayBuffer()))
    .digest("hex");
  if (uploaded !== bundleSha256)
    throw new Error("Uploaded private bundle checksum mismatch");
}

async function main(): Promise<void> {
  const [uploadArg, stylesArg, destinationArg, apply] = Bun.argv.slice(2);
  if (
    uploadArg === undefined ||
    stylesArg === undefined ||
    destinationArg === undefined ||
    (apply !== "--apply" && apply !== "--publish-only")
  ) {
    throw new Error(
      "Usage: prepare-production.ts <fresh XenForo upload> <style exports> <private output directory> (--apply | --publish-only)",
    );
  }
  const destination = path.resolve(destinationArg);
  const bundle = await packageBundle(
    path.resolve(uploadArg),
    path.resolve(stylesArg),
    destination,
  );
  if (apply === "--publish-only") {
    const gateway = ItemSchema.parse(await op(["get", gatewayItem]));
    await uploadBundle(
      s3(gateway, "storm-forum-releases", "SEAWEEDFS"),
      bundle,
    );
    process.stdout.write(
      JSON.stringify({
        bundleSha256: bundle.bundleSha256,
        bundleKey: bundle.bundleKey,
      }) + "\n",
    );
    return;
  }
  const { gateway, releases, siteKey, captchaKey } = await loadStorage();
  const postal = await preparePostal();
  const runtime = await prepareRuntime(siteKey, captchaKey, postal);
  const changed = await prepareGateway(gateway, runtime);
  await uploadBundle(releases, bundle);
  const prepared = {
    secretItemId: runtime.id,
    bundleSha256: bundle.bundleSha256,
    bundleKey: bundle.bundleKey,
    trustedConnectorCidr: "10.244.0.0/24",
    postal: {
      dkimName: postal.dkimName,
      dkimRecord: postal.dkimRecord,
      verificationRecord: postal.verificationRecord,
    },
    gatewayReloadRequired: changed,
  };
  await Bun.write(
    path.join(destination, "prerequisites.json"),
    JSON.stringify(prepared, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(prepared, null, 2) + "\n");
}

if (import.meta.main) await main();
