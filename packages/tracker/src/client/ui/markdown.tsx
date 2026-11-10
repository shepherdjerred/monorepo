import { Suspense, lazy, useId, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { z } from "zod";
import { currentActor } from "#client/data/identity.ts";
import { requestIdHeader } from "#client/live/request-ids.ts";

const MarkdownRenderer = lazy(async () => {
  const module = await import("./markdown-renderer.tsx");
  return { default: module.MarkdownRenderer };
});

/** Rendered markdown; the source text stands in while the renderer loads. */
export function Markdown({ body }: { body: string }) {
  return (
    <div className="markdown">
      <Suspense fallback={<p className="markdown-source">{body}</p>}>
        <MarkdownRenderer body={body} />
      </Suspense>
    </div>
  );
}

const tabs = [
  { name: "write", other: "preview", label: "Write", preview: false },
  { name: "preview", other: "write", label: "Preview", preview: true },
] as const;
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
  label,
  id,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onAttachments: (ids: string[]) => void;
  placeholder: string;
  /** The accessible name of the text area. */
  label: string;
  id?: string;
  required?: boolean;
}) {
  const base = useId();
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
            ...requestIdHeader(),
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
        <div role="tablist" aria-label="Editor mode">
          {tabs.map((tab) => (
            <button
              key={tab.name}
              type="button"
              role="tab"
              id={`${base}-${tab.name}`}
              aria-selected={preview === tab.preview}
              aria-controls={`${base}-panel`}
              tabIndex={preview === tab.preview ? 0 : -1}
              onClick={() => {
                setPreview(tab.preview);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setPreview(!tab.preview);
                  document
                    .querySelector<HTMLElement>(
                      `#${CSS.escape(`${base}-${tab.other}`)}`,
                    )
                    ?.focus();
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
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
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-${preview ? "preview" : "write"}`}
      >
        {preview ? (
          <Markdown body={value || "Nothing to preview yet."} />
        ) : (
          <textarea
            ref={text}
            id={id}
            required={required}
            value={value}
            placeholder={placeholder}
            aria-label={label}
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
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
              }
            }}
            onDrop={(e) => {
              if (e.dataTransfer.files.length > 0) {
                e.preventDefault();
                void upload([...e.dataTransfer.files]);
              }
            }}
          />
        )}
      </div>
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
