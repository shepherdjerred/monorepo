import type { MediaDetail } from "#shared/api.ts";
import { dateLabel, humanize } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { EmptyNote, Panel } from "#client/ui/panel.tsx";
import styles from "./manage.module.css";

const cx = classNames(styles);

/** Everything that has happened to the title, newest first. */
export function History({ media, id }: { media: MediaDetail; id: string }) {
  return (
    <Panel title="What happened before" id={id}>
      {media.events.length === 0 ? (
        <EmptyNote>Changes to this title will appear here.</EmptyNote>
      ) : (
        <ol className={cx("events")} aria-label="Title history">
          {media.events.map((event) => (
            <li className={cx("event")} key={event.id}>
              <strong>{humanize(event.kind)}</strong>
              <span className={cx("muted")}>{dateLabel(event.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
