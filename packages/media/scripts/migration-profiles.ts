import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { inventoryProfiles } from "#migration/source-inventory.ts";
import {
  importResolvedProfiles,
  ProfileSnapshotSchema,
  reportProfileDrift,
} from "#migration/profile-import.ts";

const Instance = z.object({ base_url: z.url(), api_key: z.string().min(1) });
const Config = z.object({
  radarr: z.record(z.string(), Instance),
  sonarr: z.record(z.string(), Instance),
});
async function readConfiguration(reference: string) {
  if (!reference.startsWith("op://"))
    throw new Error("A 1Password field reference is required");
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
  const value = await new Response(child.stdout).text();
  if ((await child.exited) !== 0 || value.length > 1_000_000)
    throw new Error("Source configuration credential read failed");
  return Config.parse(Bun.YAML.parse(value));
}
async function main() {
  const { values } = parseArgs({
    options: {
      snapshot: { type: "string" },
      "recyclarr-reference": { type: "string" },
      "radarr-url": { type: "string" },
      "sonarr-url": { type: "string" },
      "desired-profile": { type: "string", multiple: true },
    },
  });
  const snapshot =
    values.snapshot === undefined
      ? await liveSnapshot(values)
      : await fileSnapshot(values.snapshot, values["recyclarr-reference"]);
  const reports = importResolvedProfiles(snapshot);
  process.stdout.write(
    `${JSON.stringify({ snapshot, reports, drift: reports.map((report) => ({ source: report.source, ...reportProfileDrift(report, { profileNames: values["desired-profile"] ?? [] }) })), mayWrite: false }, null, 2)}\n`,
  );
}
async function fileSnapshot(path: string, reference: string | undefined) {
  if (reference !== undefined)
    throw new Error("Select snapshot or live inventory, not both");
  return ProfileSnapshotSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
async function liveSnapshot(values: {
  "recyclarr-reference"?: string | undefined;
  "radarr-url"?: string | undefined;
  "sonarr-url"?: string | undefined;
}) {
  const reference = values["recyclarr-reference"];
  if (reference === undefined)
    throw new Error("Use --snapshot or --recyclarr-reference");
  const config = await readConfiguration(reference);
  const inventories = [];
  for (const source of ["radarr", "sonarr"] as const) {
    const instances = Object.values(config[source]);
    const instance = instances[0];
    if (instance === undefined || instances.length !== 1)
      throw new Error("Inventory requires exactly one instance per source");
    const override = values[source === "radarr" ? "radarr-url" : "sonarr-url"];
    if (override !== undefined && new URL(override).hostname !== "127.0.0.1")
      throw new Error(
        "Source URL overrides must use a reviewed localhost port-forward",
      );
    inventories.push(
      await inventoryProfiles({
        source,
        baseUrl: override ?? instance.base_url,
        apiKey: instance.api_key,
      }),
    );
  }
  return { capturedAt: new Date().toISOString(), inventories };
}
if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error(
      "Read-only profile inventory/import failed; check source connectivity, reference, schema and version. No writes were performed.",
    );
    process.exitCode = 1;
  }
}
