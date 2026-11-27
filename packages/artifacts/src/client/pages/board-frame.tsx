import {
  FileIcon,
  FileTextIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  MaximizeIcon,
  TerminalIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { ArtifactKind } from "@shepherdjerred/artifacts/contract";
import type { ArtifactSummary } from "@shepherdjerred/artifacts/procedures";
import type { ArtifactDetail } from "#client/data/api.ts";
import { ArtifactViewer } from "#client/viewers/artifact-viewer.tsx";

const KIND_ICON: Readonly<Record<ArtifactKind, LucideIcon>> = {
  html: GlobeIcon,
  site: GlobeIcon,
  mermaid: WorkflowIcon,
  image: ImageIcon,
  video: FilmIcon,
  pdf: FileTextIcon,
  markdown: FileTextIcon,
  cast: TerminalIcon,
  file: FileIcon,
};

export const KIND_LABEL: Readonly<Record<ArtifactKind, string>> = {
  html: "HTML",
  site: "Site",
  mermaid: "Diagram",
  image: "Image",
  video: "Video",
  pdf: "PDF",
  markdown: "Markdown",
  cast: "Terminal recording",
  file: "File",
};

/** The card a frame shows when it is not one of the live few. */
function Placeholder({
  summary,
  onLoad,
}: {
  readonly summary: ArtifactSummary;
  readonly onLoad: (() => void) | null;
}): React.JSX.Element {
  const Icon = KIND_ICON[summary.kind];
  return (
    <div className="ar-placeholder" data-testid="frame-placeholder">
      <Icon aria-hidden="true" />
      <p className="ar-placeholder-kind">{KIND_LABEL[summary.kind]}</p>
      <p className="ar-placeholder-meta">
        {summary.currentVersion === null
          ? "No version"
          : `v${String(summary.currentVersion.number)}`}
        {summary.currentVersion === null
          ? ""
          : ` · ${summary.currentVersion.publisher.name}`}
      </p>
      <p className="ar-placeholder-meta">
        {summary.openThreadCount} open{" "}
        {summary.openThreadCount === 1 ? "thread" : "threads"}
      </p>
      {onLoad === null ? null : (
        <button type="button" className="ui-btn" onClick={onLoad}>
          Click to load
        </button>
      )}
    </div>
  );
}

/** One frame of the board grid: a titled cell around a viewer in node mode. */
export function BoardFrame({
  summary,
  detail,
  live,
  aspect,
  active,
  selected,
  onActiveChange,
  onSelect,
  onLoad,
}: {
  readonly summary: ArtifactSummary;
  readonly detail: ArtifactDetail | undefined;
  readonly live: boolean;
  readonly aspect: number;
  readonly active: boolean;
  readonly selected: boolean;
  readonly onActiveChange: (active: boolean) => void;
  readonly onSelect: (id: string) => void;
  readonly onLoad: () => void;
}): React.JSX.Element {
  const version = detail?.current ?? null;
  return (
    <li
      className="ar-node"
      data-frame-id={summary.id}
      data-selected={selected}
      data-testid="board-frame"
      onFocusCapture={() => {
        onSelect(summary.id);
      }}
      onPointerEnter={() => {
        onSelect(summary.id);
      }}
    >
      <div className="ar-node-head">
        <Link
          className="ar-node-title"
          to={`/a/${summary.id}`}
          aria-keyshortcuts={selected ? "F" : undefined}
        >
          {summary.title}
        </Link>
        <span className="ar-tag">
          {summary.currentVersion === null
            ? ""
            : `v${String(summary.currentVersion.number)}`}
        </span>
        {summary.openThreadCount > 0 ? (
          <span className="ar-tag" data-tone="amber">
            {summary.openThreadCount}
          </span>
        ) : null}
        <Link
          className="ar-icon-button"
          to={`/a/${summary.id}`}
          aria-label={`Open ${summary.title} full size`}
        >
          <MaximizeIcon aria-hidden="true" />
        </Link>
      </div>
      <div className="ar-node-body" style={{ aspectRatio: String(aspect) }}>
        {live && version !== null ? (
          <ArtifactViewer
            artifact={{
              id: summary.id,
              title: summary.title,
              kind: summary.kind,
            }}
            version={version}
            mode="node"
            active={active}
            onActiveChange={onActiveChange}
            preset="desktop"
          />
        ) : (
          <Placeholder
            summary={summary}
            onLoad={live || summary.kind === "file" ? null : onLoad}
          />
        )}
      </div>
    </li>
  );
}
