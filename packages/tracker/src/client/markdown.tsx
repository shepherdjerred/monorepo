import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Paperclip } from "lucide-react";
import { z } from "zod";
import { currentActor } from "./identity.ts";
import { issueLinks } from "#shared/markdown-links.ts";

export function Markdown({ body }: { body: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, issueLinks]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              rel="noreferrer"
              target={href?.startsWith("/") === true ? undefined : "_blank"}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            src?.startsWith("/attachments/") === true ? (
              <a href={src} target="_blank" rel="noreferrer">
                <img src={src} alt={alt ?? "Attachment"} loading="lazy" />
              </a>
            ) : (
              <a href={src} target="_blank" rel="noreferrer">
                {alt ?? "External image"}
              </a>
            ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

const UploadedSchema = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  contentType: z.string(),
});
export function MarkdownEditor({
  value,
  onChange,
  onAttachments,
  placeholder,
  id,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onAttachments: (ids: string[]) => void;
  placeholder: string;
  id?: string;
  required?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(value);
  latest.current = value;
  async function upload(files: File[]) {
    setUploading(true);
    setError(undefined);
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        const encoded = new TextEncoder().encode(
          JSON.stringify(currentActor()),
        );
        const response = await fetch("/api/attachments", {
          method: "POST",
          headers: {
            "X-Tracker-Actor": btoa(String.fromCodePoint(...encoded)),
          },
          body: form,
        });
        if (!response.ok)
          throw new Error(`Upload failed (${String(response.status)})`);
        const uploaded = UploadedSchema.parse(await response.json());
        const markdown = `${uploaded.contentType.startsWith("image/") ? "!" : ""}[${uploaded.filename.replaceAll(/[[\]\\]/gu, "_")}](${uploaded.url})`;
        const start = text.current?.selectionStart ?? latest.current.length;
        const end = text.current?.selectionEnd ?? start;
        const next = `${latest.current.slice(0, start)}\n${markdown}\n${latest.current.slice(end)}`;
        latest.current = next;
        onChange(next);
        onAttachments([uploaded.id]);
      }
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button
          type="button"
          className={preview ? "" : "selected"}
          onClick={() => {
            setPreview(false);
          }}
        >
          Write
        </button>
        <button
          type="button"
          className={preview ? "selected" : ""}
          onClick={() => {
            setPreview(true);
          }}
        >
          Preview
        </button>
        <span className="spacer" />
        <button
          type="button"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={14} />
          {uploading ? "Uploading…" : "Attach"}
        </button>
      </div>
      {preview ? (
        <Markdown body={value || "Nothing to preview yet."} />
      ) : (
        <textarea
          ref={text}
          id={id}
          required={required}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length > 0) {
              e.preventDefault();
              void upload(files);
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (e.dataTransfer.files.length > 0) {
              e.preventDefault();
              void upload([...e.dataTransfer.files]);
            }
          }}
        />
      )}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {error !== undefined && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-hint">
        Markdown supported · paste or drop files
      </div>
    </div>
  );
}
