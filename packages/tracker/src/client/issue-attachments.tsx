import { useState } from "react";
import { Paperclip } from "lucide-react";
import type { IssueDetailData } from "./api.ts";
import { Modal } from "./ui.tsx";

type File = IssueDetailData["attachments"][number];
const url = (file: File) =>
  `/attachments/${file.id}/${encodeURIComponent(file.filename)}`;
const isImage = (file: File) =>
  file.contentType.startsWith("image/") && file.contentType !== "image/svg+xml";

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
            <img src={url(file)} alt={file.filename} />
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
              style={{
                maxWidth: "100%",
                maxHeight: "70vh",
                objectFit: "contain",
              }}
              src={url(preview)}
              alt={preview.filename}
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
