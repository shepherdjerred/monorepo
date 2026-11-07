import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { humanize, Status } from "#client/components.tsx";

export function MovieEditionFilesV4({
  context,
}: {
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
}) {
  const asset = context.currentAsset;
  if (asset === null)
    return (
      <p className="helper">
        No current file has been published for this edition.
      </p>
    );
  return (
    <div className="asset-card">
      <div className="section-heading">
        <h4>Current edition file</h4>
        <Status value={asset.state} />
      </div>
      <p className="helper">
        {[
          asset.properties.quality,
          asset.properties.codec,
          asset.properties.hdr === true ? "HDR" : undefined,
        ]
          .filter((value) => value !== undefined)
          .join(" · ")}
      </p>
      {asset.properties.audioLanguages !== undefined && (
        <p className="helper">
          Audio: {asset.properties.audioLanguages.join(", ")}
        </p>
      )}
      {asset.captions.length === 0 ? (
        <p className="helper">
          No installed or quarantined captions for this video.
        </p>
      ) : (
        <ul className="subtitle-list">
          {asset.captions.map((caption) => (
            <li key={caption.id}>
              <span>
                {caption.language}
                {caption.forced === true ? " · Forced" : ""}
                {caption.hearingImpaired === true ? " · Hearing impaired" : ""}
                <br />
                <small className="helper">
                  {caption.accepted
                    ? "Quality verified for this video"
                    : "Quality unverified for this video"}{" "}
                  · {humanize(caption.storageKind)}
                </small>
              </span>
              <Status value={caption.state} />
            </li>
          ))}
        </ul>
      )}
      {asset.captionsTruncated && (
        <p className="helper">Showing the first 100 captions.</p>
      )}
    </div>
  );
}
