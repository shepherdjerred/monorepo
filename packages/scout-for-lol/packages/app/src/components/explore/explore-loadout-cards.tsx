import {
  EXPLORE_LOADOUT_BUILD_PATH_MAX_EVENTS,
  type ExploreLoadoutCard,
} from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@scout-for-lol/design-system/components/card";
import {
  ChampionPortrait,
  ItemIcon,
  RuneIcon,
  SummonerSpellIcon,
} from "@scout-for-lol/design-system/assets";

function ItemImage(props: { itemId: number; name: string; className: string }) {
  return (
    <ItemIcon
      item={props.itemId}
      alt={props.name}
      title={props.name}
      optional
      className={props.className}
    />
  );
}

function RuneImage(props: {
  id: number;
  assetKey: string;
  name: string;
  known?: boolean | undefined;
  kind?: "rune" | "rune tree";
  className: string;
}) {
  const kind = props.kind ?? "rune";
  const unknown =
    props.known === false ||
    (props.known === undefined && props.assetKey === String(props.id));
  if (unknown) {
    const label = `Unknown ${kind} ID ${props.id.toString()}`;
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="inline-flex min-h-7 min-w-12 items-center justify-center rounded border border-amber-500/60 bg-scout-surface px-1 text-center text-[9px] leading-tight text-scout-ink"
      >
        ID {props.id.toString()}
      </span>
    );
  }
  return (
    <RuneIcon
      rune={props.assetKey}
      alt={props.name}
      title={props.name}
      optional
      className={props.className}
    />
  );
}

function FinalBuild(props: { card: ExploreLoadoutCard; compact?: boolean }) {
  const compact = props.compact === true;
  const iconSize = compact ? "size-7" : "size-9";
  return (
    <section className={compact ? "space-y-1" : "space-y-2"}>
      <h4
        className={
          compact
            ? "sr-only"
            : "text-xs font-semibold uppercase tracking-wide text-scout-subtle"
        }
      >
        Final build
      </h4>
      <div
        className={
          compact
            ? "flex flex-wrap items-center gap-1"
            : "flex flex-wrap items-center gap-1.5"
        }
        role="list"
      >
        {props.card.finalItems.map((item) => {
          const slotName =
            item.slot === 6 ? "Trinket" : `Item slot ${String(item.slot + 1)}`;
          const itemName =
            item.itemId === null
              ? "empty"
              : (item.name ?? `Unknown item ID ${item.itemId.toString()}`);
          return (
            <div
              key={item.slot}
              role="listitem"
              aria-label={`${slotName}: ${itemName}`}
              title={`${slotName}: ${itemName}`}
              className="flex flex-col items-center gap-0.5"
            >
              {item.itemId === null ? (
                <span
                  className={`${iconSize} rounded border border-dashed border-scout-border bg-scout-surface`}
                />
              ) : item.name === null ? (
                <span
                  className={`${iconSize} flex items-center justify-center rounded border border-amber-500/60 bg-scout-surface px-0.5 text-center text-[8px] leading-tight text-scout-ink`}
                  aria-label={`Unknown item ID ${item.itemId.toString()}`}
                >
                  ID {item.itemId.toString()}
                </span>
              ) : (
                <ItemImage
                  itemId={item.itemId}
                  name={item.name}
                  className={`${iconSize} rounded border border-scout-border`}
                />
              )}
              {item.slot === 6 && (
                <span className="text-[10px] text-scout-subtle">Trinket</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Spells(props: { card: ExploreLoadoutCard; compact?: boolean }) {
  const compact = props.compact === true;
  const iconSize = compact ? "size-6" : "size-8";
  return (
    <section className={compact ? "space-y-1" : "space-y-2"}>
      <h4
        className={
          compact
            ? "sr-only"
            : "text-xs font-semibold uppercase tracking-wide text-scout-subtle"
        }
      >
        Summoner spells
      </h4>
      <div className="flex gap-1.5">
        {props.card.spells.map((spell) =>
          spell.spellId === null || spell.name === null ? (
            <span
              key={spell.slot}
              className={`${iconSize} rounded border border-dashed border-scout-border`}
              aria-label={`Spell slot ${String(spell.slot)} unavailable`}
            />
          ) : (
            <SummonerSpellIcon
              key={spell.slot}
              spell={spell.spellId}
              alt={spell.name}
              title={spell.name}
              optional
              className={`${iconSize} rounded border border-scout-border`}
            />
          ),
        )}
      </div>
    </section>
  );
}

function RunePage(props: { card: ExploreLoadoutCard }) {
  const { runePage } = props.card;
  return (
    <section className="space-y-2" aria-label="Rune page">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
        Rune page
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        {runePage.primaryTree !== null && (
          <RuneImage
            id={runePage.primaryTree.id}
            assetKey={runePage.primaryTree.assetKey}
            name={`${runePage.primaryTree.name} tree`}
            known={runePage.primaryTree.known}
            kind="rune tree"
            className="size-8 rounded-full border border-scout-border"
          />
        )}
        {runePage.keystone !== null && (
          <RuneImage
            id={runePage.keystone.id}
            assetKey={runePage.keystone.assetKey}
            name={runePage.keystone.name}
            known={runePage.keystone.known}
            className="size-9 rounded-full border border-amber-400/70"
          />
        )}
        {runePage.primaryRunes.map((rune) => (
          <RuneImage
            key={rune.id}
            id={rune.id}
            assetKey={rune.assetKey}
            name={rune.name}
            known={rune.known}
            className="size-7 rounded-full border border-scout-border"
          />
        ))}
        {runePage.secondaryTree !== null && (
          <RuneImage
            id={runePage.secondaryTree.id}
            assetKey={runePage.secondaryTree.assetKey}
            name={`${runePage.secondaryTree.name} tree`}
            known={runePage.secondaryTree.known}
            kind="rune tree"
            className="ml-2 size-8 rounded-full border border-scout-border"
          />
        )}
        {runePage.secondaryRunes.map((rune) => (
          <RuneImage
            key={rune.id}
            id={rune.id}
            assetKey={rune.assetKey}
            name={rune.name}
            known={rune.known}
            className="size-7 rounded-full border border-scout-border"
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {runePage.shards.map((shard) => (
          <Badge key={shard.slot} variant="outline" className="text-[10px]">
            {shard.slot}: {shard.id ?? "not recorded"}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function BuildPath(props: { card: ExploreLoadoutCard }) {
  if (!props.card.buildPathRecorded) {
    return (
      <section className="space-y-2" aria-label="Build path">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
          Build path
        </h4>
        <p className="text-xs text-scout-subtle">
          Timeline data is not recorded for this match. The row above is the
          final inventory.
        </p>
      </section>
    );
  }
  if (props.card.buildPath.length === 0) {
    return (
      <section className="space-y-2" aria-label="Build path">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
          Build path
        </h4>
        <p className="text-xs text-scout-subtle">
          No item purchases were recorded in the timeline.
        </p>
      </section>
    );
  }

  const eventsByMinute = Map.groupBy(
    props.card.buildPath,
    (event) => event.minute,
  );
  return (
    <section className="space-y-2" aria-label="Build path">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
        Build path
      </h4>
      {props.card.buildPathTruncated && (
        <p className="text-xs text-scout-subtle">
          Showing the most recent {EXPLORE_LOADOUT_BUILD_PATH_MAX_EVENTS}{" "}
          events; earlier item events are omitted.
        </p>
      )}
      <ol className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {[...eventsByMinute.entries()].map(([minute, events]) => (
          <li key={minute} className="flex flex-col gap-1">
            <span className="text-[10px] tabular-nums text-scout-subtle">
              {minute.toString()}m
            </span>
            <ul className="flex flex-wrap items-center gap-1.5">
              {events.map((event, index) => (
                <li
                  key={`${event.itemId.toString()}-${index.toString()}`}
                  className="flex items-center gap-1"
                  title={`${event.kind === "sold" ? "Sold" : "Bought"} ${event.name ?? `item ${event.itemId.toString()}`} at ${minute.toString()} minutes`}
                >
                  {event.name === null ? (
                    <span
                      className={`size-7 flex items-center justify-center rounded border border-amber-500/60 bg-scout-surface px-0.5 text-center text-[8px] leading-tight text-scout-ink ${event.kind === "sold" ? "opacity-50" : ""}`}
                      aria-label={`Unknown item ID ${event.itemId.toString()}`}
                    >
                      ID {event.itemId.toString()}
                    </span>
                  ) : (
                    <ItemImage
                      itemId={event.itemId}
                      name={event.name}
                      className={`size-7 rounded border border-scout-border ${event.kind === "sold" ? "opacity-50" : ""}`}
                    />
                  )}
                  {event.kind === "sold" && (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                      Sold
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SkillOrder(props: { card: ExploreLoadoutCard }) {
  if (props.card.skillOrder.length === 0) {
    return (
      <section className="space-y-2" aria-label="Skill order">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
          Skill order
        </h4>
        <p className="text-xs text-scout-subtle">
          Skill order is not recorded in the available timeline.
        </p>
      </section>
    );
  }
  const skillAtLevel = new Map(
    props.card.skillOrder.map((entry) => [entry.level, entry.skill]),
  );
  return (
    <section className="space-y-2" aria-label="Skill order">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
        Skill order
      </h4>
      <ol className="grid grid-cols-9 gap-1.5 sm:grid-cols-[repeat(18,minmax(0,1fr))]">
        {Array.from({ length: 18 }, (_, index) => {
          const level = index + 1;
          const skill = skillAtLevel.get(level);
          return (
            <li
              key={level}
              aria-label={
                skill === undefined
                  ? `Level ${level.toString()}`
                  : `Level ${level.toString()}: ${skill}`
              }
              title={
                skill === undefined
                  ? `Level ${level.toString()}`
                  : `Level ${level.toString()}: ${skill}`
              }
              className="flex aspect-square flex-col items-center justify-center rounded border border-scout-border bg-scout-surface text-[10px]"
            >
              <span className="text-scout-subtle">{level.toString()}</span>
              {skill !== undefined && (
                <span className="font-semibold text-scout-ink">{skill}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ExploreLoadoutCardView(props: { card: ExploreLoadoutCard }) {
  const { card } = props;
  const compact = card.size === "S";
  return (
    <Card className="border-scout-border bg-scout-surface">
      <CardHeader
        className={compact ? "space-y-1 px-3 py-2" : "space-y-2 pb-3"}
      >
        <div className="flex items-center gap-3">
          <ChampionPortrait
            champion={card.championId}
            alt={card.championName}
            optional
            className={`${compact ? "size-8" : "size-10"} rounded-full border border-scout-border`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-scout-ink">
              {card.championName} loadout
            </p>
            <p
              className={`${compact ? "text-[10px]" : "text-xs"} truncate text-scout-subtle`}
            >
              {card.matchId}
            </p>
          </div>
          <Badge variant="outline">{card.size}</Badge>
        </div>
      </CardHeader>
      {compact ? (
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pb-3 pt-0">
          <FinalBuild card={card} compact />
          <Spells card={card} compact />
          {card.runePage.keystone !== null && (
            <section className="flex items-center" aria-label="Keystone">
              <RuneImage
                id={card.runePage.keystone.id}
                assetKey={card.runePage.keystone.assetKey}
                name={card.runePage.keystone.name}
                known={card.runePage.keystone.known}
                className="size-7 rounded-full border border-amber-400/70"
              />
            </section>
          )}
        </CardContent>
      ) : (
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <FinalBuild card={card} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Spells card={card} />
              <RunePage card={card} />
            </div>
          </div>
          <BuildPath card={card} />
          <SkillOrder card={card} />
        </CardContent>
      )}
    </Card>
  );
}

export function ExploreLoadoutCards(props: { cards: ExploreLoadoutCard[] }) {
  if (props.cards.length === 0) return null;
  return (
    <div className="space-y-3" role="group" aria-label="Loadout cards">
      {props.cards.map((card) => (
        <ExploreLoadoutCardView
          key={`${card.matchId}:${card.participantId.toString()}:${card.size}`}
          card={card}
        />
      ))}
    </div>
  );
}
