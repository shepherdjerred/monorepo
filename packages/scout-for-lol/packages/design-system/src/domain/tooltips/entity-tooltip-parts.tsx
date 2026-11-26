import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
import { Skeleton } from "#src/components/skeleton.tsx";
import { cn } from "#src/lib/cn.ts";
import type {
  GameFactEntry,
  GameFactPart,
} from "@scout-for-lol/data/game-facts/schema.ts";

/**
 * The pieces every tooltip shares, in anatomy order: header, facts, words,
 * parts, the Scout block the page supplies, and one link out.
 */

/**
 * How a part's trigger becomes a trigger for that part's own layer. A body
 * knows its parts but not how they load, so the layer above supplies this;
 * without one a part renders as its plain trigger.
 */
export const PartContext = createContext<
  (part: GameFactPart, trigger: ReactElement) => ReactElement
>((_part, trigger) => trigger);

/** Wraps a part's trigger so it opens that part's own layer. */
export function PartTooltip(props: {
  part: GameFactPart;
  children: ReactElement;
}) {
  return useContext(PartContext)(props.part, props.children);
}

/** A game image from the patch the fact was generated for. */
export function FactImage(props: {
  patch: string;
  path: string;
  size: number;
  className?: string;
}) {
  return (
    <img
      className={props.className}
      src={`/assets/scout/game/${props.patch}/${props.path}`}
      alt=""
      width={props.size}
      height={props.size}
      loading="lazy"
      decoding="async"
    />
  );
}

/** Art, or an icon with a name, a kind and one key fact. */
export function TooltipHeader(props: {
  icon?: ReactNode;
  name: string;
  kind?: ReactNode;
  keyFact?: string | undefined;
}) {
  return (
    <div className="scout-tooltip__head">
      {props.icon}
      <span className="scout-tooltip__title">
        <b className="scout-tooltip__name">{props.name}</b>
        {props.kind === undefined ? null : (
          <span className="scout-tooltip__kind">{props.kind}</span>
        )}
      </span>
      {props.keyFact === undefined ? null : (
        <span className="scout-tooltip__key">{props.keyFact}</span>
      )}
    </div>
  );
}

/** Two or three labelled facts. */
export function TooltipFacts(props: { facts: readonly GameFactEntry[] }) {
  if (props.facts.length === 0) return null;
  return (
    <dl className="scout-tooltip__facts">
      {props.facts.slice(0, 3).map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TooltipBody(props: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("scout-tooltip__body", props.className)}>
      {props.children}
    </div>
  );
}

/** The page's own numbers, in the Scout block. */
export function TooltipScoutBlock(props: { children: ReactNode }) {
  return <div className="scout-tooltip__scout">{props.children}</div>;
}

/** One labelled line of the Scout block: "You", "Friends" or "Everyone". */
export function TooltipScoutRow(props: {
  who: string;
  /** The reader's own row takes the brand tint. */
  you?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="scout-tooltip__row">
      <dt
        className={cn(
          "scout-tooltip__who",
          props.you === true && "scout-tooltip__who--you",
        )}
      >
        {props.who}
      </dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/** Convenience shell for rows: `<TooltipScoutRows><TooltipScoutRow/>…`. */
export function TooltipScoutRows(props: {
  children: ReactNode;
  /** One quiet line below the rows, such as the patch and queue. */
  context?: string;
}) {
  return (
    <>
      <dl className="scout-tooltip__rows">{props.children}</dl>
      {props.context === undefined ? null : (
        <p className="scout-tooltip__context">{props.context}</p>
      )}
    </>
  );
}

/** The last games as a row of wins and losses. */
export function TooltipTally(props: { results: readonly boolean[] }) {
  return (
    <span className="scout-tooltip__tally" aria-hidden="true">
      {props.results.map((won, index) => (
        <i key={index} data-result={won ? "win" : "loss"} />
      ))}
    </span>
  );
}

export type TooltipLink = { href: string; label: string };

/** The way out: one link to the full page, or two for a player. */
export function TooltipFoot(props: { links: readonly TooltipLink[] }) {
  if (props.links.length === 0) return null;
  return (
    <div className="scout-tooltip__foot">
      {props.links.map((link) => (
        <a
          key={link.href}
          className="scout-button scout-button--link"
          href={link.href}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

/** What a layer shows while its fact loads. */
export function TooltipSkeleton() {
  return (
    <div
      className="scout-tooltip__loading"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="scout-tooltip__head">
        <Skeleton className="scout-tooltip__skeleton-icon" />
        <span className="scout-tooltip__title">
          <Skeleton className="scout-tooltip__skeleton-line scout-tooltip__skeleton-line--name" />
          <Skeleton className="scout-tooltip__skeleton-line scout-tooltip__skeleton-line--kind" />
        </span>
      </div>
      <TooltipBody>
        <Skeleton className="scout-tooltip__skeleton-line" />
        <Skeleton className="scout-tooltip__skeleton-line" />
        <Skeleton className="scout-tooltip__skeleton-line scout-tooltip__skeleton-line--short" />
      </TooltipBody>
    </div>
  );
}

/** A plain, short failure line. */
export function TooltipError(props: { label: string }) {
  return (
    <TooltipBody>
      <p className="scout-tooltip__error">Could not load {props.label}.</p>
    </TooltipBody>
  );
}
