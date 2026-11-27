/**
 * Class strings the redesigned pages share. The design system owns the domain
 * components; these are the small pieces of page layout around them.
 */

/** A section heading inside a panel. */
export const SECTION_HEADING =
  "m-0 font-display text-2xl leading-tight font-bold";

/** The page title in a hero. */
export const HERO_TITLE =
  "m-0 font-display text-5xl leading-none font-bold [overflow-wrap:anywhere] sm:text-6xl";

/** A text link: brand colour, underlined, firmer on hover. */
export const TEXT_LINK =
  "font-semibold text-scout-brand underline decoration-scout-brand/35 underline-offset-4 hover:decoration-current";

/** A small label beside a name, such as "Small sample". */
export const NOTE =
  "rounded-full bg-[var(--scout-surface-inset-strong)] px-3 text-[13px] leading-5 font-semibold text-scout-subtle";

/** The column every redesigned page sits in. */
export const PAGE_COLUMN =
  "mx-auto grid max-w-[1128px] gap-7 px-4 py-5 sm:px-8 sm:pt-8 sm:pb-14";

/** Two columns from the width where the mockups switch to them. */
export const TWO_COLUMNS =
  "grid items-start gap-7 min-[1181px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]";
