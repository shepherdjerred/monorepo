import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { Sticker } from "@scout-for-lol/design-system/domain/rows/sticker";
import { SECTION_HEADING } from "#src/components/friendly-classes.ts";
import { useSpaLink } from "#src/hooks/use-spa-link.ts";
import { relativeWhen } from "#src/lib/format/relative-time.ts";
import type { PlayerSticker } from "#src/lib/player/player-page.ts";

function GameSticker(props: {
  playerId: number;
  sticker: PlayerSticker;
  nowMs: number;
}) {
  const { sticker } = props;
  const link = useSpaLink(
    `/players/${props.playerId.toString()}/matches/${sticker.matchId}`,
  );
  return (
    <Sticker
      title={sticker.title}
      detail={relativeWhen(sticker.atMs, props.nowMs)}
      who={{ champion: sticker.championId }}
      href={link.href}
      onClick={link.onClick}
    />
  );
}

/** What the newest game earned. */
export function HighlightsPanel(props: {
  playerId: number;
  stickers: readonly PlayerSticker[];
  nowMs: number;
}) {
  return (
    <Panel variant="open" asChild>
      <section aria-labelledby="highlights-h">
        <h2 id="highlights-h" className={SECTION_HEADING}>
          Highlights
        </h2>
        <ul className="m-0 mt-3.5 grid list-none justify-items-start gap-2.5 p-0 max-sm:justify-items-stretch">
          {props.stickers.map((sticker) => (
            <li key={sticker.matchId}>
              <GameSticker
                playerId={props.playerId}
                sticker={sticker}
                nowMs={props.nowMs}
              />
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}
