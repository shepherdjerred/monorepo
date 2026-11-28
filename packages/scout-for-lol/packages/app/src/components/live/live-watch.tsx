import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import { SECTION_HEADING } from "#src/components/live/live-classes.ts";
import type { WatchLine } from "#src/lib/live/live-watch.ts";

/** What is worth knowing about the other team, one plain sentence each. */
export function LiveWatch(props: { lines: readonly WatchLine[] }) {
  if (props.lines.length === 0) return null;
  return (
    <section aria-labelledby="watch-h" className="px-3">
      <h2 id="watch-h" className={SECTION_HEADING}>
        Who to watch
      </h2>
      <ul className="m-0 mt-4 grid list-none gap-3.5 p-0">
        {props.lines.map((line) => (
          <li
            key={`${line.name}:${line.after}`}
            className="flex items-center gap-3.5"
          >
            <ChampionFace champion={line.championId} alt="" />
            <p className="m-0 min-w-0 leading-normal">
              {line.before} <b>{line.name}</b>, {line.after}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
