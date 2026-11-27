import { DownloadIcon, FileIcon } from "lucide-react";
import { formatBytes } from "#client/lib/format.ts";
import { contentFileUrl, type ViewerProps } from "./types.ts";

/** Anything the service cannot show: a card that downloads it. */
export function FileViewer({
  artifact,
  version,
  adapterRef,
}: ViewerProps): React.JSX.Element {
  adapterRef.current = null;
  const file = version.files.find(
    (candidate) => candidate.path === version.entryPath,
  );
  const href = contentFileUrl(version, version.entryPath);
  return (
    <div className="ar-file-card" data-testid="file-card">
      <FileIcon aria-hidden="true" />
      <div>
        <h2>{artifact.title}</h2>
        <p>
          {version.entryPath}
          {file === undefined
            ? ""
            : ` · ${formatBytes(file.size)} · ${file.mediaType}`}
        </p>
      </div>
      {href === null ? (
        <p className="ar-note">This version’s files were deleted.</p>
      ) : (
        <a
          className="ui-btn"
          data-variant="primary"
          data-size="page"
          href={href}
          download={version.entryPath}
        >
          <DownloadIcon aria-hidden="true" />
          Download
        </a>
      )}
    </div>
  );
}
