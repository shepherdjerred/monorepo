import {
  ScoutCustomPublicationInputSchema,
  type ScoutCustomPublicationInput,
} from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import { syncCustomRecruitmentMessage } from "#src/customs/recruitment-message.ts";
import configuration from "#src/configuration.ts";

export async function publishDurableCustomNight(
  rawInput: ScoutCustomPublicationInput,
): Promise<void> {
  const input = ScoutCustomPublicationInputSchema.parse(rawInput);
  if (configuration.runtimeCapabilities.httpSurface !== "full")
    throw new Error("Only the application can publish Customs sockets");
  const night = await prisma.customNight.findUniqueOrThrow({
    where: { id: input.nightId },
  });
  if (night.revision < input.revision)
    throw new Error("Customs publication asks for an uncommitted revision");
  if (night.publishedRevision >= input.revision) return;
  // Existing-message edits are idempotent; missing creations use the durable
  // recruitment intent rather than sending from this Activity.
  await syncCustomRecruitmentMessage(prisma, input.nightId);
  await publishCustomNightSnapshot(input.nightId);
  await prisma.customNight.updateMany({
    where: { id: input.nightId, publishedRevision: { lt: input.revision } },
    data: { publishedRevision: input.revision },
  });
}
