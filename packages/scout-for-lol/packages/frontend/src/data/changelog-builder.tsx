import type { ReactNode } from "react";

export type ChangelogEntry = {
  date: string;
  banner: ReactNode;
  text: ReactNode;
  formatted: {
    year: number;
    month: number;
    day: number;
  };
};

export type ColorScheme =
  "yellow" | "indigo" | "blue" | "purple" | "green" | "red" | "pink" | "teal";

/** Public alias for the changelog section color palette. */
export type ChangelogColor = ColorScheme;

type ChangelogSectionProps = {
  title: string;
  color: ColorScheme;
  items: string[];
  className?: string;
};

const colorClasses: Record<
  ColorScheme,
  {
    border: string;
    bg: string;
    titleText: string;
    bodyText: string;
    dot: string;
    arrow: string;
  }
> = {
  yellow: {
    border: "border-scout-warning ",
    bg: "bg-scout-warning ",
    titleText: "text-scout-warning-ink ",
    bodyText: "text-scout-warning-ink ",
    dot: "bg-scout-warning ",
    arrow: "text-scout-warning-ink ",
  },
  indigo: {
    border: "border-scout-brand ",
    bg: "bg-scout-raised ",
    titleText: "text-scout-brand ",
    bodyText: "text-scout-ink ",
    dot: "bg-scout-brand ",
    arrow: "text-scout-brand ",
  },
  blue: {
    border: "border-scout-brand ",
    bg: "bg-scout-raised ",
    titleText: "text-scout-brand ",
    bodyText: "text-scout-ink ",
    dot: "bg-scout-brand ",
    arrow: "text-scout-brand ",
  },
  purple: {
    border: "border-scout-accent ",
    bg: "bg-scout-accent ",
    titleText: "text-scout-accent-ink ",
    bodyText: "text-scout-accent-ink ",
    dot: "bg-scout-accent ",
    arrow: "text-scout-accent-ink ",
  },
  green: {
    border: "border-scout-success ",
    bg: "bg-scout-success ",
    titleText: "text-scout-success-ink ",
    bodyText: "text-scout-success-ink ",
    dot: "bg-scout-success ",
    arrow: "text-scout-success-ink ",
  },
  red: {
    border: "border-scout-danger ",
    bg: "bg-scout-danger ",
    titleText: "text-scout-danger-ink ",
    bodyText: "text-scout-danger-ink ",
    dot: "bg-scout-danger ",
    arrow: "text-scout-danger-ink ",
  },
  pink: {
    border: "border-scout-accent ",
    bg: "bg-scout-accent ",
    titleText: "text-scout-accent-ink ",
    bodyText: "text-scout-accent-ink ",
    dot: "bg-scout-accent ",
    arrow: "text-scout-accent-ink ",
  },
  teal: {
    border: "border-scout-accent ",
    bg: "bg-scout-accent ",
    titleText: "text-scout-accent-ink ",
    bodyText: "text-scout-accent-ink ",
    dot: "bg-scout-accent ",
    arrow: "text-scout-accent-ink ",
  },
};

export function ChangelogSection({
  title,
  color,
  items,
  className = "",
}: ChangelogSectionProps) {
  const colors = colorClasses[color];

  return (
    <section
      className={`border-l-4 ${colors.border} ${colors.bg} rounded-r-lg p-4 ${className}`}
    >
      <h3
        className={`text-lg font-bold ${colors.titleText} mb-3 flex items-center gap-2`}
      >
        <span
          className={`inline-block w-2 h-2 ${colors.dot} rounded-full`}
        ></span>
        {title}
      </h3>
      <ul className="space-y-2 list-none pl-4">
        {items.map((item, index) => (
          <li
            key={index}
            className={`${colors.bodyText} flex items-start gap-3`}
          >
            <span className={`${colors.arrow} font-bold text-lg leading-none`}>
              →
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type ChangelogSectionInput = {
  title: string;
  color: ChangelogColor;
  items: string[];
};

export type ChangelogLinkInput = {
  label: string;
  href: string;
};

export type ChangelogEntryInput = {
  /** Display date in `"YYYY MM DD"` form, matching the hand-authored entries. */
  date: string;
  /** Plain-text banner shown on the homepage banner + as the entry heading. */
  banner: string;
  sections: ChangelogSectionInput[];
  /** Optional external link rendered below the sections (e.g. Riot patch notes). */
  link?: ChangelogLinkInput;
};

/**
 * Build a {@link ChangelogEntry} from plain structured data.
 *
 * Both humans and the Data Dragon / season-refresh automations use this so
 * auto-generated "What's New" entries share one format with the hand-authored
 * rich-JSX entries. The automations insert a `buildChangelogEntry({...})` call
 * at the top of the `changelog` array.
 */
export function buildChangelogEntry(
  input: ChangelogEntryInput,
): ChangelogEntry {
  const match = /^(\d{4}) (\d{2}) (\d{2})$/.exec(input.date);
  if (match === null) {
    throw new Error(
      `Invalid changelog date ${JSON.stringify(input.date)} — expected "YYYY MM DD"`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(
      `Invalid changelog date ${JSON.stringify(input.date)} — month/day out of range`,
    );
  }
  if (input.sections.length === 0) {
    throw new Error("Changelog entry must have at least one section");
  }
  return {
    date: input.date,
    banner: <>{input.banner}</>,
    text: (
      <>
        {input.sections.map((section, index) => (
          <ChangelogSection
            key={index}
            title={section.title}
            color={section.color}
            items={section.items}
            className={index > 0 ? "mt-6" : ""}
          />
        ))}
        {input.link && (
          <a
            href={input.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-1 font-semibold text-scout-brand hover:underline "
          >
            {input.link.label}
            <span aria-hidden="true">→</span>
          </a>
        )}
      </>
    ),
    formatted: { year, month, day },
  };
}
