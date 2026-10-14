import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { QualificationManifest, qualifyCapacity } from "./qualification.ts";

const args = parseArgs({
  strict: true,
  options: { manifest: { type: "string" }, output: { type: "string" } },
});
const manifestFile = path.resolve(
  z.string().min(1).parse(args.values.manifest),
);
const output = path.resolve(z.string().min(1).parse(args.values.output));
const manifest = QualificationManifest.parse(
  await Bun.file(manifestFile).json(),
);
const sources = await Promise.all(
  manifest.reports.map(async (file) => {
    const bytes = await Bun.file(
      path.resolve(path.dirname(manifestFile), file),
    ).arrayBuffer();
    return {
      file,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      value: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    };
  }),
);
const result = qualifyCapacity(manifest, sources);
await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.warn(
  JSON.stringify({
    recommendation: result.recommendation,
    behaviorLabel: result.behaviorLabel,
    deploymentAccepted: result.deploymentAccepted,
    output,
  }),
);
if (result.recommendation === null) process.exitCode = 1;
