import {
  ManualSubtitleSchema,
  MAX_MANUAL_SUBTITLE_BYTES,
  type ManualSubtitle,
  type SubtitleTarget,
} from "#shared/admin.ts";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string") throw new TypeError(`Missing ${key}`);
  return value;
}

async function fileBase64(file: File): Promise<string> {
  if (file.size === 0 || file.size > MAX_MANUAL_SUBTITLE_BYTES)
    throw new Error("Choose a subtitle file no larger than 8 MiB.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(new Error("Could not read the subtitle file."));
    });
    reader.addEventListener("load", () => {
      const result =
        typeof reader.result === "string"
          ? reader.result.split(",")[1]
          : undefined;
      if (result === undefined)
        reject(new Error("Could not encode the subtitle file."));
      else resolve(result);
    });
    reader.readAsDataURL(file);
  });
}

export async function readSubtitleUpload(
  form: FormData,
  target: SubtitleTarget,
): Promise<ManualSubtitle> {
  const file = form.get("subtitle");
  if (!(file instanceof File)) throw new TypeError("Choose a subtitle file.");
  const declaredEncoding = text(form, "encoding");
  const replacementId = text(form, "replacementFor");
  const old = target.subtitles.find(
    (subtitle) => subtitle.id === replacementId,
  );
  if (replacementId !== "" && old === undefined)
    throw new Error(
      "The replacement subtitle must belong to the selected video.",
    );
  return ManualSubtitleSchema.parse({
    assetId: target.assetId,
    expectedAssetVersion: target.version,
    expectedChecksum: target.checksum,
    language: text(form, "language"),
    filename: file.name,
    description: text(form, "description"),
    contentBase64: await fileBase64(file),
    confirmedMatchingVideo: form.get("confirmed") === "on",
    forced: form.get("forced") === "on",
    ...(text(form, "hearingImpaired") === "unknown"
      ? {}
      : { hearingImpaired: text(form, "hearingImpaired") === "yes" }),
    ...(declaredEncoding === "bom" ? {} : { declaredEncoding }),
    ...(old === undefined
      ? {}
      : {
          replacementFor: {
            oldSubtitleId: old.id,
            expectedOldVersion: old.version,
          },
        }),
  });
}
