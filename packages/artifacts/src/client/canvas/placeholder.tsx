import {
  FileIcon,
  FileTextIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  TerminalIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { ArtifactKind } from "@shepherdjerred/artifacts/contract";
import type { ArtifactSummary } from "@shepherdjerred/artifacts/procedures";

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

/** The typed card a frame shows when it is not one of the previews. */
export function Placeholder({
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
