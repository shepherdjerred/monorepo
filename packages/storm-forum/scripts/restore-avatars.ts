import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { productionCommand } from "./prepare-production.ts";

// Explicit live data recovery; never runs as part of releases or startup.
// bun packages/storm-forum/scripts/restore-avatars.ts [--apply]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Bun.argv.slice(2);
if (args.some((arg) => arg !== "--apply") || args.length > 1) {
  throw new Error("Expected no arguments (dry run), or --apply");
}
const manifest = z
  .array(
    z.object({
      originalId: z.number().int().positive(),
      expectedUserId: z.number().int().positive(),
      historicalName: z.string().min(1),
      file: z.string().regex(/^avatar-\d+\.png$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      provenance: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("archived"),
          originalHostPath: z.string().min(1),
          capturedAt: z.string().regex(/^\d{14}$/),
        }),
        z.object({
          kind: z.literal("current-minecraft"),
          sourceUrl: z.url(),
          fetchedAt: z.iso.datetime(),
          minecraftName: z.string().regex(/^\w{1,16}$/),
          uuid: z.string().regex(/^[a-f0-9]{32}$/),
          identityEvidence: z.string().min(1),
        }),
      ]),
    }),
  )
  .parse(await Bun.file(path.join(root, "config/avatar-recovery.json")).json());
const avatars = await Promise.all(
  manifest.map(async (item) => {
    const bytes = Buffer.from(
      await Bun.file(
        path.join(root, "assets/avatar-recovery", item.file),
      ).arrayBuffer(),
    );
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) {
      throw new Error(`Recovery asset checksum mismatch: ${item.file}`);
    }
    return { ...item, image: bytes.toString("base64") };
  }),
);
const payload = Buffer.from(
  JSON.stringify({ apply: args.includes("--apply"), avatars }),
).toString("base64");
const script = await Bun.file(
  path.join(root, "scripts/restore-avatars.php"),
).text();
const code = `<?php\n$payload = json_decode(base64_decode('${payload}'), true, 512, JSON_THROW_ON_ERROR);\n${script.replace(/^<\?php\s*/, "")}`;
const output = await productionCommand(
  [
    "kubectl",
    "exec",
    "-i",
    "-n",
    "storm-forum",
    "deployment/storm-forum-web",
    "-c",
    "php",
    "--",
    "php",
  ],
  code,
);
process.stdout.write(output);
