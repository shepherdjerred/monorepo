import {
  EXPLORE_MAX_ATTACHMENTS,
  ExploreAttachmentMediaTypeSchema,
  type ExploreAttachment,
} from "@scout-for-lol/data";

/**
 * Images on an Explore question: what the composer accepts and where an
 * attached image is read back from.
 */

/** Matches the server's limit for one image. */
export const EXPLORE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const EXPLORE_IMAGE_ACCEPT =
  ExploreAttachmentMediaTypeSchema.options.join(",");

/** Why a file cannot be attached, or null when it can. */
export function imageRefusal(
  file: { readonly type: string; readonly size: number },
  alreadyAttached: number,
): string | null {
  if (alreadyAttached >= EXPLORE_MAX_ATTACHMENTS)
    return `A question can carry up to ${EXPLORE_MAX_ATTACHMENTS.toString()} images.`;
  if (!ExploreAttachmentMediaTypeSchema.safeParse(file.type).success)
    return "Attach a PNG, JPEG or WebP image.";
  return file.size > EXPLORE_IMAGE_MAX_BYTES
    ? "Images must be 10 MiB or smaller."
    : null;
}

/** The image files among pasted or dropped items, in order. */
export function imageFiles(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith("image/"));
}

export function exploreAttachmentUrl(attachment: ExploreAttachment): string {
  return `/api/explore/attachments/${attachment.id}`;
}

export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(new Error("Could not read the image. Attach it again."));
    });
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The image could not be read."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    });
    reader.readAsDataURL(file);
  });
}
