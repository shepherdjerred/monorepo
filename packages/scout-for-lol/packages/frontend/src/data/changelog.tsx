import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

export function renderChangelogToHtml(content: ReactNode): string {
  return renderToStaticMarkup(content);
}

type ColorScheme = "yellow" | "indigo" | "blue" | "purple" | "green" | "red" | "pink" | "teal";

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

function ChangelogSection({ title, color, items, className = "" }: ChangelogSectionProps) {
  const colors = colorClasses[color];

  return (
    <section className={`border-l-4 ${colors.border} ${colors.bg} rounded-r-lg p-4 ${className}`}>
      <h3 className={`text-lg font-bold ${colors.titleText} mb-3 flex items-center gap-2`}>
        <span className={`inline-block w-2 h-2 ${colors.dot} rounded-full`}></span>
        {title}
      </h3>
      <ul className="space-y-2 list-none pl-4">
        {items.map((item, index) => (
          <li key={index} className="text-gray-700 dark:text-gray-300 flex items-start gap-3">
            <span className={`${colors.arrow} font-bold text-lg leading-none`}>→</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const changelog: ChangelogEntry[] = [
  {
    date: "2026 01 31",
    banner: (
      <>
        <strong>Season 2026</strong> data updates and Arena improvements
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Season 2026 Support"
          color="indigo"
          items={[
            "Support for new Riot API data structures including role-specific starting items",
            "Updated champion, item, and rune data for latest patches",
          ]}
        />
        <ChangelogSection
          title="Arena"
          color="purple"
          items={[
            "Improved arena augment data with complete augment icons",
            "More reliable augment display in match reports",
          ]}
          className="mt-6"
        />
        <ChangelogSection
          title="Bug Fixes"
          color="green"
          items={["Improved reliability and stability", "Various performance improvements"]}
          className="mt-6"
        />
      </>
    ),
    formatted: {
      year: 2026,
      month: 1,
      day: 31,
    },
  },
  {
    date: "2025 11 30",
    banner: (
      <>
        <strong>Rune displays</strong> on match reports
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Match Reports"
          color="green"
          items={["Display rune selections for all players in match reports"]}
        />
      </>
    ),
    formatted: {
      year: 2025,
      month: 11,
      day: 30,
    },
  },
  {
    date: "2025 11 23",
    banner: (
      <>
        <strong>Clash indicator</strong> and <strong>promotions/demotions</strong> on match reports
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Match Reports"
          color="yellow"
          items={[
            "Add clash badge indicator for clash and ARAM clash games",
            "Display promotions and demotions for all players in flex and duo queue matches",
          ]}
        />
      </>
    ),
    formatted: {
      year: 2025,
      month: 11,
      day: 23,
    },
  },
  {
    date: "2025 11 16",
    banner: (
      <>
        <strong>Arena reports</strong> with augment icons, <strong>subscription limits</strong> increased, and more!
      </>
    ),
    text: (
      <>
        <ChangelogSection
          title="Arena Reports"
          color="indigo"
          items={["Add augment icons", "Reorganize report image layout", "Add team KDA"]}
          className="mb-6"
        />
        <ChangelogSection
          title="Subscription Commands"
          color="blue"
          items={[
            "Increase limits from 10 → 50 accounts per server",
            "Increase limits from 10 → 75 subscriptions per server",
            "Add messages for approaching limits",
          ]}
          className="mb-6"
        />
        <ChangelogSection title="Site" color="purple" items={["Add changelog and What's New page"]} />
      </>
    ),
    formatted: {
      year: 2025,
      month: 11,
      day: 16,
    },
  },
];

export function formatChangelogDate(entry: ChangelogEntry): string {
  const { year, month, day } = entry.formatted;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
