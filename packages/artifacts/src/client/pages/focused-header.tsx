import { Tabs } from "@shepherdjerred/console-ui";
import { ExternalLinkIcon, MessageCircleIcon } from "lucide-react";
import { Link } from "react-router";
import type {
  VersionSummary,
  VersionView,
} from "@shepherdjerred/artifacts/procedures";
import { FloatingNav } from "#client/shell/floating-nav.tsx";
import { formatAge } from "#client/lib/format.ts";
import type { PresetId } from "#client/viewers/types.ts";

export const PRESET_OPTIONS: readonly { value: PresetId; label: string }[] = [
  { value: "mobile", label: "390" },
  { value: "tablet", label: "768" },
  { value: "desktop", label: "1440" },
  { value: "responsive", label: "Fit" },
];

export function defaultPreset(viewport: VersionSummary["viewport"]): PresetId {
  if (viewport === null) return "desktop";
  if (viewport.width >= 1200) return "desktop";
  return viewport.width >= 700 ? "tablet" : "mobile";
}

/** The floating nav for one artifact: board › title, the version, and Open raw. */
export function FocusedNav({
  title,
  boardSlug,
  boardTitle,
  versions,
  shown,
  version,
  onVersion,
}: {
  readonly title: string;
  readonly boardSlug: string;
  readonly boardTitle: string;
  readonly versions: readonly VersionSummary[];
  readonly shown: VersionSummary;
  readonly version: VersionView | undefined;
  readonly onVersion: (number: number) => void;
}): React.JSX.Element {
  const latest = versions[0]?.number;
  const raw =
    version?.contentUrl == null
      ? null
      : new URL(encodeURI(version.entryPath), version.contentUrl).href;
  return (
    <FloatingNav
      lead={
        <>
          <Link className="ar-fnav-crumb" to={`/b/${boardSlug}?view=canvas`}>
            {boardTitle}
          </Link>
          <span className="ar-fnav-arrow" aria-hidden="true">
            ›
          </span>
          <h1 className="ar-fnav-title">{title}</h1>
        </>
      }
      actions={
        <>
          <label className="ar-fnav-select">
            <span className="ui-sr-only">Version</span>
            <select
              value={shown.number}
              onChange={(event) => {
                onVersion(Number(event.target.value));
              }}
            >
              {versions.map((candidate) => (
                <option key={candidate.id} value={candidate.number}>
                  v{candidate.number}
                  {candidate.number === latest ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </label>
          {raw === null ? null : (
            <a
              className="ar-icon-button"
              href={raw}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open raw"
              title="Open raw"
            >
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          )}
        </>
      }
      menu={[
        ...versions.map((candidate) => ({
          key: `v${String(candidate.number)}`,
          label: `Version v${String(candidate.number)}${candidate.number === latest ? " (latest)" : ""}${candidate.number === shown.number ? ", shown" : ""}`,
          onSelect: () => {
            onVersion(candidate.number);
          },
        })),
        {
          key: "board",
          label: `Board: ${boardTitle}`,
          to: `/b/${boardSlug}?view=canvas`,
        },
        ...(raw === null
          ? []
          : [
              {
                key: "raw",
                label: "Open raw",
                onSelect: () => {
                  globalThis.open(raw, "_blank", "noopener,noreferrer");
                },
              },
            ]),
      ]}
    />
  );
}

/** Who published the version shown, and their note; it leads the comments panel. */
export function VersionMeta({
  shown,
}: {
  readonly shown: VersionSummary;
}): React.JSX.Element {
  return (
    <p className="ar-focus-meta">
      {shown.publisher.name} published {formatAge(shown.createdAt)}
      {shown.note === "" ? null : (
        <span className="ar-note-text">{shown.note}</span>
      )}
    </p>
  );
}

/** The bottom pill of the focused view: comment mode, and the viewport width of a frame. */
export function FocusedTools({
  framed,
  preset,
  onPreset,
  commentMode,
  onCommentMode,
}: {
  readonly framed: boolean;
  readonly preset: PresetId;
  readonly onPreset: (preset: PresetId) => void;
  readonly commentMode: boolean;
  readonly onCommentMode: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div
      className="ar-cv-toolbar ar-focus-tools"
      role="toolbar"
      aria-label="Viewer tools"
    >
      {framed ? (
        <>
          <Tabs
            label="Viewport width"
            value={preset}
            onChange={onPreset}
            options={PRESET_OPTIONS}
          />
          <span className="ar-cv-sep" aria-hidden="true" />
        </>
      ) : null}
      <button
        type="button"
        className="ar-cv-tool"
        aria-label="Comment mode"
        aria-pressed={commentMode}
        aria-keyshortcuts="C"
        data-testid="comment-mode"
        title="Comment mode: click to place a pin (C)"
        onClick={() => {
          onCommentMode(!commentMode);
        }}
      >
        <MessageCircleIcon aria-hidden="true" size={20} strokeWidth={1.5} />
      </button>
    </div>
  );
}
