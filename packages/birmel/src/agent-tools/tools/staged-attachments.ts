import { AttachmentBuilder } from "discord.js";
import type { StagedAttachment } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";

/** Discord caps an attachment description at this many characters. */
const MAX_ATTACHMENT_DESCRIPTION_CHARACTERS = 1024;

/**
 * A tool stages an attachment into the request context rather than sending it,
 * so whatever owns the turn's delivery decides when it goes out. Both delivery
 * surfaces — the interactive reply and a scheduled job's message — build the
 * discord.js payload the same way, and a generated image is dropped entirely by
 * any surface that forgets to.
 */
export function toDiscordAttachments(
  staged: readonly StagedAttachment[],
): AttachmentBuilder[] {
  return staged.map(
    (attachment) =>
      new AttachmentBuilder(Buffer.from(attachment.data), {
        name: attachment.name,
        ...(attachment.description == null
          ? {}
          : {
              description: attachment.description.slice(
                0,
                MAX_ATTACHMENT_DESCRIPTION_CHARACTERS,
              ),
            }),
      }),
  );
}
