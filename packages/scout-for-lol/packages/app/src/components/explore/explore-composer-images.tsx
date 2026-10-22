import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, X } from "lucide-react";
import { ExploreAttachmentMediaTypeSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/query/trpc.ts";
import {
  imageRefusal,
  readFileBase64,
} from "#src/lib/explore/explore-attachments.ts";

/**
 * Images waiting in the composer.
 *
 * Each upload starts as soon as it is pasted, dropped or picked, so sending
 * only names the stored ids. A failed upload stays visible with its reason
 * until removed; it is never sent.
 */

export type ComposerImage = {
  readonly key: string;
  readonly name: string;
  readonly previewUrl: string;
  readonly status: "uploading" | "ready" | "failed";
  readonly id: string | null;
  readonly error: string | null;
};

export function useComposerImages() {
  const trpc = useTRPC();
  const upload = useMutation(
    trpc.explore.uploadAttachment.mutationOptions({ retry: false }),
  );
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Object URLs hold the file in memory until revoked.
  useEffect(
    () => () => {
      for (const image of imagesRef.current)
        URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  const settle = useCallback(
    (key: string, patch: Pick<ComposerImage, "status" | "id" | "error">) => {
      setImages((current) =>
        current.map((image) =>
          image.key === key ? { ...image, ...patch } : image,
        ),
      );
    },
    [],
  );

  const add = useCallback(
    (files: readonly File[]) => {
      let count = imagesRef.current.length;
      for (const file of files) {
        const refusal = imageRefusal(file, count);
        if (refusal !== null) {
          setNotice(refusal);
          continue;
        }
        count += 1;
        setNotice(null);
        const key = crypto.randomUUID();
        setImages((current) => [
          ...current,
          {
            key,
            name: file.name,
            previewUrl: URL.createObjectURL(file),
            status: "uploading",
            id: null,
            error: null,
          },
        ]);
        void (async () => {
          try {
            const stored = await upload.mutateAsync({
              mediaType: ExploreAttachmentMediaTypeSchema.parse(file.type),
              base64: await readFileBase64(file),
            });
            settle(key, { status: "ready", id: stored.id, error: null });
          } catch (error) {
            settle(key, {
              status: "failed",
              id: null,
              error:
                error instanceof Error
                  ? error.message
                  : "The image could not be uploaded.",
            });
          }
        })();
      }
    },
    [settle, upload],
  );

  const remove = useCallback((key: string) => {
    setImages((current) => {
      const removed = current.find((image) => image.key === key);
      if (removed !== undefined) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    for (const image of imagesRef.current)
      URL.revokeObjectURL(image.previewUrl);
    setImages([]);
    setNotice(null);
  }, []);

  return {
    images,
    notice,
    add,
    remove,
    clear,
    uploading: images.some((image) => image.status === "uploading"),
    readyIds: images.flatMap((image) =>
      image.status === "ready" && image.id !== null ? [image.id] : [],
    ),
  };
}

export function ComposerImageStrip(props: {
  images: readonly ComposerImage[];
  notice: string | null;
  onRemove: (key: string) => void;
}) {
  const { images, notice, onRemove } = props;
  if (notice === null && images.length === 0) return null;
  const message =
    notice ?? images.find((image) => image.error !== null)?.error ?? null;
  return (
    <div className="flex flex-col gap-1.5 pt-1.5 pr-1.5">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Attached images">
          {images.map((image) => (
            <li
              key={image.key}
              className={`relative size-14 overflow-hidden rounded-lg border ${
                image.status === "failed"
                  ? "border-scout-danger"
                  : "border-scout-border"
              }`}
              title={image.error ?? image.name}
            >
              <img
                src={image.previewUrl}
                alt={image.name}
                className={`size-full object-cover ${
                  image.status === "ready" ? "" : "opacity-50"
                }`}
              />
              {image.status === "uploading" && (
                <LoaderCircle
                  className="absolute inset-0 m-auto size-5 animate-spin text-scout-ink"
                  aria-label="Uploading"
                />
              )}
              <button
                type="button"
                className="absolute top-0.5 right-0.5 rounded-full bg-scout-surface/90 p-0.5 text-scout-ink hover:bg-scout-hover"
                aria-label={`Remove ${image.name}`}
                onClick={() => {
                  onRemove(image.key);
                }}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {message !== null && (
        <p role="alert" className="text-xs text-scout-danger">
          {message}
        </p>
      )}
    </div>
  );
}
