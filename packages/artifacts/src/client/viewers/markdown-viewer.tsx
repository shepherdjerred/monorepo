import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  contains,
  contentAnchor,
  contentAnchorToClient,
} from "#client/lib/geometry.ts";
import {
  contentFileUrl,
  type AnchorAdapter,
  type ViewerProps,
} from "./types.ts";
import { useAdapterRegistration } from "./use-adapter-registration.ts";

const PROTOCOL = /^[a-z][a-z0-9+.-]*:|^\/\//iu;

/**
 * Where a markdown reference points. An absolute URL is external; a relative
 * one resolves against the document inside the content prefix and is refused
 * when it climbs out of it.
 */
export function resolveReference(
  reference: string,
  documentUrl: string,
  prefix: string,
): { kind: "external"; href: string } | { kind: "local"; href: string } | null {
  if (PROTOCOL.test(reference)) {
    try {
      const url = new URL(reference, "https://invalid.example");
      return url.protocol === "http:" || url.protocol === "https:"
        ? { kind: "external", href: url.href }
        : null;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(reference, documentUrl);
    return url.href.startsWith(prefix)
      ? { kind: "local", href: url.href }
      : null;
  } catch {
    return null;
  }
}

export function MarkdownViewer({
  artifact,
  version,
  review,
  adapterRef,
  onViewChange,
}: ViewerProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const documentUrl = contentFileUrl(version, version.entryPath);
  const prefix = version.contentUrl;

  const source = useQuery({
    queryKey: ["markdown", documentUrl],
    enabled: documentUrl !== null,
    queryFn: async () => {
      if (documentUrl === null) return "";
      const response = await fetch(documentUrl, {
        referrerPolicy: "no-referrer",
      });
      if (!response.ok)
        throw new Error(
          `Could not load the document (${String(response.status)})`,
        );
      return response.text();
    },
  });

  const adapter = useMemo<AnchorAdapter>(
    () => ({
      toAnchor(point) {
        const content = contentRef.current;
        if (content === null) return null;
        const rect = content.getBoundingClientRect();
        return contains(rect, point)
          ? contentAnchor(version.entryPath, rect, point)
          : null;
      },
      toClient(anchor) {
        const content = contentRef.current;
        return content === null || anchor.type !== "doc"
          ? null
          : contentAnchorToClient(anchor, content.getBoundingClientRect());
      },
      reveal(anchor) {
        const content = contentRef.current;
        const scroller = scrollRef.current;
        if (content === null || scroller === null || anchor.type !== "doc")
          return;
        const ratio = content.getBoundingClientRect().width / anchor.docWidth;
        scroller.scrollTo({ top: Math.max(0, anchor.y * ratio - 120) });
      },
    }),
    [version.entryPath],
  );

  useAdapterRegistration(adapterRef, adapter, onViewChange);

  useEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    const observer = new ResizeObserver(onViewChange);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [onViewChange, source.data]);

  if (documentUrl === null || prefix === null)
    return <p className="ar-note">This version’s files were deleted.</p>;
  if (source.isError)
    return (
      <p className="ar-note" role="alert">
        {source.error.message}
      </p>
    );

  return (
    <div
      className="ar-md-scroll"
      ref={scrollRef}
      onScroll={onViewChange}
      data-testid="markdown-scroll"
    >
      <article
        className="ar-md"
        ref={contentRef}
        aria-label={artifact.title}
        data-commenting={review?.commentMode === true}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const target =
                href === undefined
                  ? null
                  : resolveReference(href, documentUrl, prefix);
              return target === null ? (
                <span>{children}</span>
              ) : (
                <a href={target.href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              );
            },
            img: ({ src, alt }) => {
              const target =
                src === undefined
                  ? null
                  : resolveReference(src, documentUrl, prefix);
              if (target === null) return <span>{alt ?? "Image"}</span>;
              // Remote images are links: loading one would tell its host a reviewer is reading.
              return target.kind === "external" ? (
                <a href={target.href} target="_blank" rel="noreferrer noopener">
                  {alt === undefined || alt === "" ? target.href : alt}
                </a>
              ) : (
                <img
                  src={target.href}
                  alt={alt ?? ""}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onLoad={onViewChange}
                />
              );
            },
          }}
        >
          {source.data ?? ""}
        </ReactMarkdown>
      </article>
    </div>
  );
}
