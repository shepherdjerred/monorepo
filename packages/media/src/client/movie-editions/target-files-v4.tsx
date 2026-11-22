import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { humanize } from "#client/components.tsx";
import { StatusBadge } from "#client/status/badge.tsx";
import { SubtitleRequirements } from "#client/status/subtitle-requirements.tsx";
import { Badge } from "#client/ui/feedback.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { FactList } from "#client/ui/record.tsx";
import { EmptyNote } from "#client/ui/panel.tsx";
import styles from "./edition.module.css";
import { classNames } from "#client/ui/class-names.ts";

const cx = classNames(styles);

export function MovieEditionFilesV4({
  context,
}: {
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
}) {
  const asset = context.currentAsset;
  if (asset === null)
    return (
      <EmptyNote>
        No current file has been published for this edition.
      </EmptyNote>
    );
  const properties = [
    asset.properties.quality,
    asset.properties.codec,
    asset.properties.hdr === true ? "HDR" : undefined,
  ].filter((value) => value !== undefined);
  return (
    <div className={cx("file")}>
      <div className={cx("fileHead")}>
        <h4 className={cx("fileTitle")}>Current edition file</h4>
        <StatusBadge value={asset.state} />
      </div>
      <FactList
        facts={[
          ...(properties.length === 0
            ? []
            : [{ term: "Video", detail: properties.join(", ") }]),
          ...(asset.properties.audioLanguages === undefined
            ? []
            : [
                {
                  term: "Audio",
                  detail: asset.properties.audioLanguages.join(", "),
                },
              ]),
        ]}
      />
      {asset.subtitleStatus !== null && (
        <SubtitleRequirements status={asset.subtitleStatus} />
      )}
      {asset.captions.length === 0 ? (
        <EmptyNote>
          No installed or quarantined captions for this video.
        </EmptyNote>
      ) : (
        <DataList label="Captions">
          {asset.captions.map((caption) => (
            <DataRow
              key={caption.id}
              title={
                <span className={cx("captionName")}>
                  {caption.language}
                  {caption.forced === true && <Badge>Forced</Badge>}
                  {caption.hearingImpaired === true && (
                    <Badge>Hearing impaired</Badge>
                  )}
                </span>
              }
              detail={`${
                caption.accepted
                  ? "Quality verified for this video"
                  : "Quality unverified for this video"
              }. Stored as ${humanize(caption.storageKind).toLowerCase()}.`}
              status={<StatusBadge value={caption.state} />}
            />
          ))}
        </DataList>
      )}
      {asset.captionsTruncated && (
        <p className={cx("muted")}>Showing the first 100 captions.</p>
      )}
    </div>
  );
}
