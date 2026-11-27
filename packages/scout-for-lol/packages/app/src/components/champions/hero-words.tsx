import type { ReactNode } from "react";

/**
 * The words in a champion page's hero: the name, one plain statement and the
 * fact behind it. `HeroPanel` lays the hero out; its words are the page's.
 */
export function HeroWords(props: {
  id: string;
  title: string;
  lead: string;
  sub?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <>
      <h1
        className="m-0 font-display text-5xl leading-none font-bold [overflow-wrap:anywhere] sm:text-6xl"
        id={props.id}
      >
        {props.title}
      </h1>
      <p className="mt-4 mb-0 font-display text-3xl leading-tight text-balance">
        {props.lead}
      </p>
      {props.sub === undefined ? null : (
        <p className="mt-3 mb-0 max-w-[46ch] text-lg text-pretty text-scout-subtle">
          {props.sub}
        </p>
      )}
      {props.children}
    </>
  );
}
