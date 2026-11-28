import { Tabs } from "@shepherdjerred/console-ui";
import { ExternalLinkIcon, MessageSquarePlusIcon } from "lucide-react";
import { Link } from "react-router";
import type {
  VersionSummary,
  VersionView,
} from "@shepherdjerred/artifacts/procedures";
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

export function FocusedHeader({
  title,
  boardSlug,
  boardTitle,
  versions,
  shown,
  version,
  framed,
  preset,
  onPreset,
  commentMode,
  onCommentMode,
  onVersion,
}: {
  readonly title: string;
  readonly boardSlug: string;
  readonly boardTitle: string;
  readonly versions: readonly VersionSummary[];
  readonly shown: VersionSummary;
  readonly version: VersionView | undefined;
  readonly framed: boolean;
  readonly preset: PresetId;
  readonly onPreset: (preset: PresetId) => void;
  readonly commentMode: boolean;
  readonly onCommentMode: (on: boolean) => void;
  readonly onVersion: (number: number) => void;
}): React.JSX.Element {
  const latest = versions[0]?.number;
  return (
    <header className="ar-focus-head">
      <div className="ar-focus-title">
        <p className="ar-crumbs">
          <Link to={`/b/${boardSlug}?grid=1`}>{boardTitle}</Link>
        </p>
        <h1>{title}</h1>
        <p className="ar-focus-meta">
          {shown.publisher.name} published {formatAge(shown.createdAt)}
          {shown.note === "" ? null : (
            <span className="ar-note-text">{shown.note}</span>
          )}
        </p>
      </div>
      <div className="ar-focus-tools">
        <label className="ar-select">
          <span>Version</span>
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
        {framed ? (
          <Tabs
            label="Viewport width"
            value={preset}
            onChange={onPreset}
            options={PRESET_OPTIONS}
          />
        ) : null}
        <button
          type="button"
          className="ui-btn"
          data-variant={commentMode ? "primary" : "default"}
          aria-pressed={commentMode}
          aria-keyshortcuts="C"
          data-testid="comment-mode"
          onClick={() => {
            onCommentMode(!commentMode);
          }}
        >
          <MessageSquarePlusIcon aria-hidden="true" />
          Comment
        </button>
        {version?.contentUrl == null ? null : (
          <a
            className="ui-btn"
            href={
              new URL(encodeURI(version.entryPath), version.contentUrl).href
            }
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLinkIcon aria-hidden="true" />
            Open raw
          </a>
        )}
      </div>
    </header>
  );
}
