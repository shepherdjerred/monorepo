import {
  getItemInfo,
  getRuneInfo,
  getRuneTreeName,
  summoner,
  type MatchLoadout,
  type MatchRunePage,
} from "@scout-for-lol/data";
import {
  ItemIcon,
  RuneIcon,
  SummonerSpellIcon,
} from "@scout-for-lol/design-system/assets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@scout-for-lol/design-system/components/overlays/popover";

function runeTreeName(treeId: number): string {
  const name = getRuneTreeName(treeId);
  if (name === undefined) {
    throw new Error(`Unknown rune tree id ${treeId.toString()}`);
  }
  return name;
}

function spellInfo(spellId: number): { name: string; assetKey: string } {
  const spell = Object.values(summoner.data).find(
    (candidate) => Number(candidate.key) === spellId,
  );
  if (spell === undefined) {
    throw new Error(`Unknown summoner spell id ${spellId.toString()}`);
  }
  return { name: spell.name, assetKey: spell.id };
}

function SummonerSpell(props: { spellId: number }) {
  const spell = spellInfo(props.spellId);
  return (
    <SummonerSpellIcon
      spell={spell.assetKey}
      alt={spell.name}
      title={spell.name}
      className="size-5 rounded"
    />
  );
}

function itemName(itemId: number): string {
  const item = getItemInfo(itemId);
  if (item === undefined) {
    throw new Error(`Unknown item id ${itemId.toString()}`);
  }
  return item.name;
}

function RuneList(props: { label: string; runeIds: readonly number[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-scout-subtle">
        {props.label}
      </p>
      <ul className="space-y-1.5">
        {props.runeIds.map((runeId) => (
          <RuneRow key={runeId} runeId={runeId} />
        ))}
      </ul>
    </div>
  );
}

function RuneRow(props: { runeId: number }) {
  const rune = getRuneInfo(props.runeId);
  if (rune === undefined) {
    throw new Error(`Unknown rune id ${props.runeId.toString()}`);
  }
  return (
    <li className="flex items-center gap-2 text-sm">
      <RuneIcon rune={rune.icon} alt="" className="size-7 rounded-full" />
      <span>{rune.name}</span>
    </li>
  );
}

function RunePagePopover(props: { runes: MatchRunePage }) {
  const keystoneId = props.runes.primaryRuneIds[0];
  const keystone = getRuneInfo(keystoneId);
  if (keystone === undefined) {
    throw new Error(`Unknown rune id ${keystoneId.toString()}`);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full ring-offset-background transition hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`View full rune page, ${keystone.name} keystone`}
        >
          <RuneIcon
            rune={keystone.icon}
            alt=""
            className="size-7 rounded-full"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-4 p-4">
        <RuneList
          label={runeTreeName(props.runes.primaryStyleId)}
          runeIds={props.runes.primaryRuneIds}
        />
        <RuneList
          label={runeTreeName(props.runes.secondaryStyleId)}
          runeIds={props.runes.secondaryRuneIds}
        />
        <div>
          <p className="mb-1 text-xs font-medium text-scout-subtle">
            Stat shards
          </p>
          <ul className="space-y-1.5 text-sm">
            {[
              { label: "Offense", id: props.runes.statShardIds.offense },
              { label: "Flex", id: props.runes.statShardIds.flex },
              { label: "Defense", id: props.runes.statShardIds.defense },
            ].map((shard) => (
              <li key={shard.label}>
                <span>
                  {shard.label}: {shard.id.toString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MatchLoadoutDisplay(props: { loadout: MatchLoadout }) {
  return (
    <div className="flex items-center gap-1.5" aria-label="Match loadout">
      <div className="grid grid-cols-1 gap-0.5">
        {props.loadout.summonerSpellIds.map((spellId) => (
          <SummonerSpell key={spellId} spellId={spellId} />
        ))}
      </div>
      {props.loadout.runes === null ? (
        <span
          className="flex size-7 items-center justify-center rounded-full border text-xs text-scout-subtle"
          title="Rune page unavailable"
          aria-label="Rune page unavailable"
        >
          —
        </span>
      ) : (
        <RunePagePopover runes={props.loadout.runes} />
      )}
      <div className="grid grid-cols-7 gap-0.5">
        {props.loadout.itemIds.map((itemId, index) =>
          itemId === 0 ? (
            <span
              key={`empty-${index.toString()}`}
              className="size-6 rounded border bg-muted/40"
              aria-label={`Empty item slot ${(index + 1).toString()}`}
            />
          ) : (
            <ItemIcon
              key={`${index.toString()}:${itemId.toString()}`}
              item={itemId}
              alt={itemName(itemId)}
              title={itemName(itemId)}
              className="size-6 rounded"
            />
          ),
        )}
      </div>
    </div>
  );
}
