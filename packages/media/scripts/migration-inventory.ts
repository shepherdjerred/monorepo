import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AdoptionTargetSchema,
  EvidenceHashSchema,
  MAX_MIGRATION_BYTES,
} from "#shared/migration.ts";
import { validateCapture } from "#migration/capture/capture-validation.ts";
import { normalizeCapture } from "#migration/normalize.ts";
import { compareCaptures } from "#migration/delta.ts";
import { captureManager } from "#migration/capture/manager-capture.ts";
import { captureSeerr } from "#migration/capture/seerr-capture.ts";
import { captureBazarr } from "#migration/capture/bazarr-capture.ts";
import { captureTorrents } from "#migration/capture/torrent-capture.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";

async function capture(input: {
  kind: string;
  instanceId: string;
  baseUrl: string;
  reference: string | undefined;
  usernameReference: string | undefined;
  passwordReference: string | undefined;
}) {
  if (input.kind === "qbittorrent") {
    const client = new QbittorrentClient({
      baseUrl: z.url().parse(input.baseUrl),
      category: "media",
      username: await credential(z.string().parse(input.usernameReference)),
      password: await credential(z.string().parse(input.passwordReference)),
    });
    await client.login();
    const version = await client.version();
    const snapshot = await captureTorrents({
      client,
      sourceInstanceId: EvidenceHashSchema.parse(input.instanceId),
      version,
    });
    if ((await client.version()) !== version)
      throw new Error("Torrent service changed during capture");
    return snapshot;
  }
  const source = z
    .enum(["radarr", "sonarr", "overseerr", "jellyseerr", "seerr", "bazarr"])
    .parse(input.kind);
  const connection = {
    sourceInstanceId: EvidenceHashSchema.parse(input.instanceId),
    baseUrl: z.url().parse(input.baseUrl),
    apiKey: await credential(z.string().parse(input.reference)),
  };
  if (source === "bazarr") return await captureBazarr(connection);
  return source === "radarr" || source === "sonarr"
    ? await captureManager({ ...connection, source })
    : await captureSeerr({ ...connection, source });
}

async function jsonFile(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (file.size > MAX_MIGRATION_BYTES) throw new Error("Input exceeds limit");
  return await file.json();
}
async function credential(reference: string): Promise<string> {
  if (!reference.startsWith("op://"))
    throw new Error("Use a vault field reference");
  const wrapper = fileURLToPath(
    new URL(
      "../../../scripts/onepassword/with-service-account.sh",
      import.meta.url,
    ),
  );
  const child = Bun.spawn([wrapper, "op", "read", reference], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: 30_000,
  });
  const output = await new Response(child.stdout).text();
  const value = output.trim();
  if ((await child.exited) !== 0 || value.length === 0 || value.length > 10_000)
    throw new Error("Credential read failed");
  return value;
}
async function main() {
  const { values } = parseArgs({
    options: {
      snapshot: { type: "string" },
      baseline: { type: "string" },
      targets: { type: "string" },
      capture: { type: "string" },
      "base-url": { type: "string" },
      "api-key-reference": { type: "string" },
      "username-reference": { type: "string" },
      "password-reference": { type: "string" },
      "instance-id": { type: "string" },
    },
  });
  if ((values.snapshot === undefined) === (values.capture === undefined))
    throw new Error("Choose exactly one capture or snapshot input");
  const snapshot =
    values.snapshot === undefined
      ? await capture({
          kind: z.string().parse(values.capture),
          instanceId: EvidenceHashSchema.parse(values["instance-id"]),
          baseUrl: z.url().parse(values["base-url"]),
          reference: values["api-key-reference"],
          usernameReference: values["username-reference"],
          passwordReference: values["password-reference"],
        })
      : validateCapture(await jsonFile(values.snapshot)).snapshot;
  const targets =
    values.targets === undefined
      ? []
      : z
          .array(AdoptionTargetSchema)
          .max(50_000)
          .parse(await jsonFile(values.targets));
  const report = normalizeCapture(snapshot, { targets });
  const delta =
    values.baseline === undefined
      ? null
      : compareCaptures(await jsonFile(values.baseline), snapshot);
  process.stdout.write(
    `${JSON.stringify({ snapshot, report, delta, mayTransferOwnership: false }, null, 2)}\n`,
  );
}
if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error(
      "Read-only migration inventory failed. Check bounded input, source connectivity and vault reference; no writes were performed.",
    );
    process.exitCode = 1;
  }
}
