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
  | "yellow"
  | "indigo"
  | "blue"
  | "purple"
  | "green"
  | "red"
  | "pink"
  | "teal";

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
    dot: string;
    arrow: string;
  }
> = {
  yellow: {
    border: "border-yellow-600 dark:border-yellow-500",
    bg: "bg-yellow-50 dark:bg-yellow-900/30",
    titleText: "text-yellow-900 dark:text-yellow-300",
    dot: "bg-yellow-600 dark:bg-yellow-400",
    arrow: "text-yellow-600 dark:text-yellow-400",
  },
  indigo: {
    border: "border-indigo-600 dark:border-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-900/30",
    titleText: "text-indigo-900 dark:text-indigo-300",
    dot: "bg-indigo-600 dark:bg-indigo-400",
    arrow: "text-indigo-600 dark:text-indigo-400",
  },
  blue: {
    border: "border-blue-600 dark:border-blue-500",
    bg: "bg-blue-50 dark:bg-blue-900/30",
    titleText: "text-blue-900 dark:text-blue-300",
    dot: "bg-blue-600 dark:bg-blue-400",
    arrow: "text-blue-600 dark:text-blue-400",
  },
  purple: {
    border: "border-purple-600 dark:border-purple-500",
    bg: "bg-purple-50 dark:bg-purple-900/30",
    titleText: "text-purple-900 dark:text-purple-300",
    dot: "bg-purple-600 dark:bg-purple-400",
    arrow: "text-purple-600 dark:text-purple-400",
  },
  green: {
    border: "border-green-600 dark:border-green-500",
    bg: "bg-green-50 dark:bg-green-900/30",
    titleText: "text-green-900 dark:text-green-300",
    dot: "bg-green-600 dark:bg-green-400",
    arrow: "text-green-600 dark:text-green-400",
  },
  red: {
    border: "border-red-600 dark:border-red-500",
    bg: "bg-red-50 dark:bg-red-900/30",
    titleText: "text-red-900 dark:text-red-300",
    dot: "bg-red-600 dark:bg-red-400",
    arrow: "text-red-600 dark:text-red-400",
  },
  pink: {
    border: "border-pink-600 dark:border-pink-500",
    bg: "bg-pink-50 dark:bg-pink-900/30",
    titleText: "text-pink-900 dark:text-pink-300",
    dot: "bg-pink-600 dark:bg-pink-400",
    arrow: "text-pink-600 dark:text-pink-400",
  },
  teal: {
    border: "border-teal-600 dark:border-teal-500",
    bg: "bg-teal-50 dark:bg-teal-900/30",
    titleText: "text-teal-900 dark:text-teal-300",
    dot: "bg-teal-600 dark:bg-teal-400",
    arrow: "text-teal-600 dark:text-teal-400",
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
            className="text-gray-700 dark:text-gray-300 flex items-start gap-3"
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
            className="mt-6 inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
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
