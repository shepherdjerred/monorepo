import type { MediaDetail } from "#shared/api.ts";
import { dateLabel, humanize } from "#client/components.tsx";
import { StatusBadge } from "#client/status/badge.tsx";
import { SubtitleRequirements } from "#client/status/subtitle-requirements.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge } from "#client/ui/feedback.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
} from "#client/ui/panel.tsx";
import { TechnicalDetails } from "#client/ui/record.tsx";
import styles from "./manage.module.css";

const cx = classNames(styles);

type Recorded = MediaDetail["assets"][number];

function RecordedFile({ recorded }: { recorded: Recorded }) {
  const { asset, current, edition } = recorded;
  return (
    <Disclosure
      title={current ? "Current version" : "Previous version"}
      open={current}
      meta={<StatusBadge value={asset.state} />}
    >
      <div className={cx("file")}>
        <p className={cx("muted")}>
          {humanize(edition)} edition. Added {dateLabel(asset.createdAt)}.
        </p>
        {asset.subtitleStatus !== null && (
          <SubtitleRequirements status={asset.subtitleStatus} />
        )}
        {asset.subtitles.length === 0 ? (
          <EmptyNote>No matched subtitles yet.</EmptyNote>
        ) : (
          <DataList label="Matched subtitles">
            {asset.subtitles.map((subtitle) => (
              <DataRow
                key={subtitle.id}
                title={
                  <span className={cx("subtitleName")}>
                    {subtitle.language}, from {subtitle.providerId}
                    {subtitle.forced === true && <Badge>Forced</Badge>}
                  </span>
                }
                detail={
                  subtitle.accepted
                    ? "Quality verified for this video"
                    : "Quality unverified for this video"
                }
                status={<StatusBadge value={subtitle.state} />}
              />
            ))}
          </DataList>
        )}
        <DisclosureList>
          <TechnicalDetails label="Media properties" value={asset.properties} />
        </DisclosureList>
      </div>
    </Disclosure>
  );
}

/**
 * The files the system has recorded for the title, current first: their
 * state, the subtitles they have and still need, and their properties.
 */
export function RecordedFiles({
  media,
  id,
}: {
  media: MediaDetail;
  id: string;
}) {
  return (
    <Panel
      title="What files it has"
      id={id}
      description={
        media.kind === "movie"
          ? "The files of the unmarked edition. Other editions show theirs under Change an edition."
          : undefined
      }
    >
      {media.assets.length === 0 ? (
        <EmptyNote>
          No files have been published yet. Download and import progress is
          shown under What is happening now.
        </EmptyNote>
      ) : (
        <DisclosureList>
          {media.assets.map((recorded) => (
            <RecordedFile key={recorded.asset.id} recorded={recorded} />
          ))}
        </DisclosureList>
      )}
    </Panel>
  );
}
