import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import { readRequiredHandoff, writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import { z } from "zod";

const ArtifactPublicationSchema = z
  .object({
    serviceId: z.enum(["static-sites", "scout-for-lol"]),
    artifact: ArtifactInputSchema,
  })
  .strict();
const rawScout: unknown = JSON.parse(
  await readRequiredHandoff("scout-site-artifacts"),
);
const artifacts = z.array(ArtifactPublicationSchema).parse(rawScout);
for await (const file of new Bun.Glob("*.json").scan({
  cwd: ".delivery-artifacts",
  onlyFiles: true,
})) {
  const raw: unknown = await Bun.file(`.delivery-artifacts/${file}`).json();
  artifacts.push({
    serviceId: "static-sites",
    artifact: ArtifactInputSchema.parse(raw),
  });
}
await writeJsonHandoff("site-artifacts", artifacts);
