import { useState } from "react";
import { Paperclip } from "lucide-react";
import type { IssueDetailData } from "#client/data/api.ts";
import { Modal } from "#client/ui/ui.tsx";

type File = IssueDetailData["attachments"][number];
const url = (file: File) =>
  `/attachments/${file.id}/${encodeURIComponent(file.filename)}`;
const isImage = (file: File) =>
  file.contentType.startsWith("image/") && file.contentType !== "image/svg+xml";
/** Stored pixel size reserves the image's box before it loads. */
const dimensions = (file: File) =>
  file.width === null || file.height === null
    ? {}
    : { width: file.width, height: file.height };

export function IssueAttachments({ files }: { files: File[] }) {
  const [preview, setPreview] = useState<File>();
  if (files.length === 0) return null;
  return (
    <section className="attachments">
      <h2>
        <Paperclip size={15} />
        Attachments
      </h2>
      {files.map((file) =>
        isImage(file) ? (
          <button
            key={file.id}
            onClick={() => {
              setPreview(file);
            }}
          >
            <img
              src={url(file)}
              alt={file.filename}
              loading="lazy"
              {...dimensions(file)}
            />
            <span>{file.filename}</span>
          </button>
        ) : (
          <a key={file.id} href={url(file)} target="_blank" rel="noreferrer">
            {file.filename}
          </a>
        ),
      )}
      <Modal
        title={preview?.filename ?? "Attachment"}
        open={preview !== undefined}
        onClose={() => {
          setPreview(undefined);
        }}
      >
        {preview !== undefined && (
          <>
            <img
              className="attachment-preview"
              src={url(preview)}
              alt={preview.filename}
              {...dimensions(preview)}
            />
            <a href={url(preview)} target="_blank" rel="noreferrer">
              Open original
            </a>
          </>
        )}
      </Modal>
    </section>
  );
}
