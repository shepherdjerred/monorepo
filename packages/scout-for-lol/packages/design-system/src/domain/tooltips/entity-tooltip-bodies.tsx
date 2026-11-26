import type { ReactNode } from "react";
import {
  FactImage,
  PartTooltip,
  TooltipBody,
  TooltipFacts,
  TooltipFoot,
  TooltipHeader,
  TooltipScoutBlock,
  type TooltipLink,
} from "#src/domain/tooltips/entity-tooltip-parts.tsx";
import {
  splitKeywords,
  splitPassives,
} from "#src/domain/tooltips/entity-tooltip-text.ts";
import type {
  AbilityFact,
  ChampionFact,
  GameFact,
  GameFactEntry,
  GameFactPart,
  ItemFact,
  KeywordFact,
  RuneFact,
  SummonerSpellFact,
} from "#src/domain/tooltips/game-fact-types.ts";

/** What the page adds to one layer: its own block, and the one link out. */
export type EntityTooltipBodyExtras = {
  /** Scout's block for this layer: how you and your friends do with it. */
  scout?: ReactNode | undefined;
  /** The full page for this entity, where one exists. */
  href?: string | undefined;
  /** Defaults to "Open <name>". */
  linkLabel?: string | undefined;
};

type FactProps<Fact extends GameFact> = EntityTooltipBodyExtras & {
  fact: Fact;
};

function Foot(props: { name: string } & EntityTooltipBodyExtras) {
  const links: TooltipLink[] =
    props.href === undefined
      ? []
      : [{ href: props.href, label: props.linkLabel ?? `Open ${props.name}` }];
  return <TooltipFoot links={links} />;
}

function Scout(props: { scout: ReactNode }) {
  return props.scout === undefined || props.scout === null ? null : (
    <TooltipScoutBlock>{props.scout}</TooltipScoutBlock>
  );
}

function FactIcon(props: {
  fact: { patch: string; icon: string };
  size?: number;
  round?: boolean;
}) {
  return (
    <FactImage
      className={
        props.round === true
          ? "scout-tooltip__icon scout-tooltip__icon--round"
          : "scout-tooltip__icon"
      }
      patch={props.fact.patch}
      path={props.fact.icon}
      size={props.size ?? 52}
    />
  );
}

/** The game's description, with keyword mentions opening their own layers. */
function Description(props: { text: string; parts: readonly GameFactPart[] }) {
  const keywords = props.parts.filter((part) => part.kind === "keyword");
  const { segments, unmentioned } = splitKeywords(props.text, keywords);
  return (
    <>
      <p className="scout-tooltip__desc">
        {segments.map((segment, index) =>
          segment.type === "text" ? (
            segment.text
          ) : (
            <PartTooltip
              key={`${segment.part.key}-${String(index)}`}
              part={segment.part}
            >
              <button type="button" className="scout-tooltip__keyword">
                {segment.text}
              </button>
            </PartTooltip>
          ),
        )}
      </p>
      {unmentioned.length === 0 ? null : (
        <ul className="scout-tooltip__chips">
          {unmentioned.map((part) => (
            <li key={part.key}>
              <PartTooltip part={part}>
                <button type="button" className="scout-tooltip__chip">
                  {part.name}
                </button>
              </PartTooltip>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Parts with a small icon and a name, each opening its own layer. */
function PartList(props: {
  label: string;
  patch: string;
  parts: readonly GameFactPart[];
  trailing?: ReactNode;
}) {
  if (props.parts.length === 0) return null;
  return (
    <ul className="scout-tooltip__recipe" aria-label={props.label}>
      {props.parts.map((part) => (
        <li key={part.key}>
          <PartTooltip part={part}>
            <button type="button" className="scout-tooltip__part">
              {part.icon === null ? null : (
                <FactImage patch={props.patch} path={part.icon} size={28} />
              )}
              <span>{part.name}</span>
            </button>
          </PartTooltip>
        </li>
      ))}
      {props.trailing}
    </ul>
  );
}

function slotOf(key: string): AbilityFact["slot"] {
  const slot = key.slice(key.lastIndexOf("-") + 1);
  return slot === "Q" || slot === "W" || slot === "E" || slot === "R"
    ? slot
    : "passive";
}

function slotLetter(slot: AbilityFact["slot"]): string {
  return slot === "passive" ? "P" : slot;
}

export function ChampionTooltip(props: FactProps<ChampionFact>) {
  const { fact } = props;
  const abilities = fact.parts.filter((part) => part.kind === "ability");
  return (
    <>
      <div className="scout-tooltip__art">
        <FactImage patch={fact.patch} path={fact.art} size={356} />
        <div className="scout-tooltip__art-text">
          <b className="scout-tooltip__name">{fact.name}</b>
          <span className="scout-tooltip__kind">{fact.title}</span>
        </div>
      </div>
      <TooltipBody>
        <ul className="scout-tooltip__chips">
          {fact.roles.map((role) => (
            <li key={role} className="scout-tooltip__chip">
              {role}
            </li>
          ))}
        </ul>
        <TooltipFacts facts={fact.facts} />
        <p className="scout-tooltip__desc scout-tooltip__desc--clamp">
          {fact.description}
        </p>
        {abilities.length === 0 ? null : (
          <ul className="scout-tooltip__abilities" aria-label="Abilities">
            {abilities.map((part) => (
              <li key={part.key}>
                <PartTooltip part={part}>
                  <button
                    type="button"
                    className="scout-tooltip__ability"
                    aria-label={part.name}
                  >
                    {part.icon === null ? null : (
                      <FactImage
                        patch={fact.patch}
                        path={part.icon}
                        size={44}
                      />
                    )}
                    <span aria-hidden="true">
                      {slotLetter(slotOf(part.key))}
                    </span>
                  </button>
                </PartTooltip>
              </li>
            ))}
          </ul>
        )}
        <Scout scout={props.scout} />
      </TooltipBody>
      <Foot name={fact.name} href={props.href} linkLabel={props.linkLabel} />
    </>
  );
}

/** A rank table row, only when the value changes with rank. */
function rankRows(fact: AbilityFact): { label: string; values: number[] }[] {
  const rows = [
    { label: "Cooldown, seconds", values: fact.cooldownByRank },
    {
      label:
        fact.costType === "" ? "Cost" : `Cost, ${fact.costType.toLowerCase()}`,
      values: fact.costByRank,
    },
    { label: "Range", values: fact.rangeByRank },
  ];
  return rows.filter((row) => new Set(row.values).size > 1);
}

export function AbilityTooltip(props: FactProps<AbilityFact>) {
  const { fact } = props;
  const rows = rankRows(fact);
  const facts: GameFactEntry[] = [fact.keyFact, ...fact.facts];
  return (
    <>
      <TooltipHeader
        icon={<FactIcon fact={fact} />}
        name={fact.name}
        kind={
          fact.slot === "passive"
            ? `${fact.championName}'s passive`
            : `${fact.championName}'s ${fact.slot}`
        }
        keyFact={slotLetter(fact.slot)}
      />
      <TooltipBody>
        <TooltipFacts facts={facts} />
        <Description text={fact.description} parts={fact.parts} />
        {rows.length === 0 ? null : (
          <table className="scout-tooltip__ranks">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                {Array.from({ length: fact.maxRank }, (_, index) => (
                  <th key={index} scope="col">
                    {index + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((value, index) => (
                    <td key={index}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Scout scout={props.scout} />
      </TooltipBody>
      <Foot name={fact.name} href={props.href} linkLabel={props.linkLabel} />
    </>
  );
}

export function ItemTooltip(props: FactProps<ItemFact>) {
  const { fact } = props;
  const passives = splitPassives(fact.description);
  return (
    <>
      <TooltipHeader
        icon={<FactIcon fact={fact} />}
        name={fact.name}
        kind="Item"
        keyFact={fact.keyFact.value}
      />
      <TooltipBody>
        <TooltipFacts facts={fact.facts} />
        {passives.map((passive) => (
          <p key={passive.name ?? passive.text} className="scout-tooltip__desc">
            {passive.name === undefined ? null : <b>{passive.name}. </b>}
            {passive.text}
          </p>
        ))}
        <PartList
          label="Builds from"
          patch={fact.patch}
          parts={fact.parts}
          trailing={
            fact.goldCombine === 0 ? null : (
              <li className="scout-tooltip__part scout-tooltip__part--static">
                <i className="scout-tooltip__coin" aria-hidden="true" />
                <span>{fact.goldCombine} gold</span>
              </li>
            )
          }
        />
        <Scout scout={props.scout} />
      </TooltipBody>
      <Foot name={fact.name} href={props.href} linkLabel={props.linkLabel} />
    </>
  );
}

export function RuneTooltip(props: FactProps<RuneFact>) {
  const { fact } = props;
  const type = fact.facts.find((entry) => entry.label === "Type");
  const rest = fact.facts.filter((entry) => entry !== type);
  return (
    <>
      <TooltipHeader
        icon={<FactIcon fact={fact} round />}
        name={fact.name}
        kind={
          type === undefined
            ? fact.tree
            : `${fact.tree} ${type.value.toLowerCase()}`
        }
      />
      <TooltipBody>
        <TooltipFacts facts={rest} />
        <p className="scout-tooltip__desc">{fact.description}</p>
        <Scout scout={props.scout} />
      </TooltipBody>
      <Foot name={fact.name} href={props.href} linkLabel={props.linkLabel} />
    </>
  );
}

export function SummonerSpellTooltip(props: FactProps<SummonerSpellFact>) {
  const { fact } = props;
  return (
    <>
      <TooltipHeader
        icon={<FactIcon fact={fact} />}
        name={fact.name}
        kind="Summoner spell"
        keyFact={fact.keyFact.value}
      />
      <TooltipBody>
        <TooltipFacts facts={fact.facts} />
        <p className="scout-tooltip__desc">{fact.description}</p>
        <Scout scout={props.scout} />
      </TooltipBody>
      <Foot name={fact.name} href={props.href} linkLabel={props.linkLabel} />
    </>
  );
}

export function KeywordTooltip(props: FactProps<KeywordFact>) {
  const { fact } = props;
  return (
    <>
      <TooltipHeader
        icon={
          fact.icon === null ? null : (
            <FactIcon fact={{ patch: fact.patch, icon: fact.icon }} size={40} />
          )
        }
        name={fact.name}
        kind="Keyword"
        keyFact={fact.keyFact?.value}
      />
      <TooltipBody>
        <TooltipFacts facts={fact.facts} />
        <Description text={fact.description} parts={fact.parts} />
        <PartList
          label="Related"
          patch={fact.patch}
          parts={fact.parts.filter((part) => part.kind !== "keyword")}
        />
        <Scout scout={props.scout} />
      </TooltipBody>
      <Foot name={fact.name} href={props.href} linkLabel={props.linkLabel} />
    </>
  );
}

/** The body for any fact, chosen by its kind. */
export function EntityTooltipBody(props: FactProps<GameFact>) {
  const { fact, ...extras } = props;
  switch (fact.kind) {
    case "champion":
      return <ChampionTooltip fact={fact} {...extras} />;
    case "ability":
      return <AbilityTooltip fact={fact} {...extras} />;
    case "item":
      return <ItemTooltip fact={fact} {...extras} />;
    case "rune":
      return <RuneTooltip fact={fact} {...extras} />;
    case "summoner-spell":
      return <SummonerSpellTooltip fact={fact} {...extras} />;
    case "keyword":
      return <KeywordTooltip fact={fact} {...extras} />;
  }
}
